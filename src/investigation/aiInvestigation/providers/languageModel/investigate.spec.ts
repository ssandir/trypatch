import { createVault } from 'flare-redact'
import { z } from 'zod'
import {
    mockLanguageModel,
    mockOutcomeTurn,
    mockToolCallTurn,
    type MockCallOptions,
    type MockGenerateResult,
} from '../../../../test/mockLanguageModel'
import { Tool } from '../../../../tools'
import { buildInvestigationResultSchema } from '../../resultSchema'
import { createLanguageModel } from './createLanguageModel'
import { investigateWithLanguageModel } from './investigate'

jest.mock('./createLanguageModel')

describe('investigateWithLanguageModel', () => {
    const outcomeSchema = buildInvestigationResultSchema({
        resultSchema: z.object({ rootCause: z.string() }),
    })
    const prompts = { systemPrompt: 'Investigate', userPrompt: 'Something failed' }
    const config = { provider: 'claude', apiKey: 'key' } as const

    function finalOutcome (rootCause: string): MockGenerateResult {
        return mockOutcomeTurn({ type: 'result', result: { rootCause } })
    }

    function useModel (...turns: MockGenerateResult[]): ReturnType<typeof mockLanguageModel> {
        const model = mockLanguageModel(...turns)
        jest.mocked(createLanguageModel).mockReturnValue(model)
        return model
    }

    function toolResultsSentIn (call: MockCallOptions | undefined): unknown[] {
        return (call?.prompt ?? [])
            .filter(message => message.role === 'tool')
            .flatMap(message => message.content)
            .map(part => ('output' in part ? part.output : undefined))
    }

    const lookupOrder = jest.fn((input: { orderId: string }, context?: { region: string }) => ({
        orderId: input.orderId,
        region: context?.region,
        status: 'stuck',
    }))
    const orderTool = new Tool({
        name: 'lookup_order',
        description: 'Look up an order',
        parameters: z.object({ orderId: z.string() }),
        execute: lookupOrder,
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    it('should return the outcome directly when the model calls no tools', async () => {
        const model = useModel(finalOutcome('rate limited'))

        const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, { timeoutMs: 5_000 })

        expect(result).toEqual({ type: 'result', result: { rootCause: 'rate limited' } })
        expect(model.doGenerateCalls).toHaveLength(1)
        expect(model.doGenerateCalls[0]?.tools).toBeUndefined()
    })

    it('should run investigation tools with the tool context and feed results into the next turn', async () => {
        const model = useModel(
            mockToolCallTurn('lookup_order', { orderId: 'o-1' }),
            finalOutcome('order o-1 is stuck'),
        )

        const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            investigationTools: [orderTool],
            toolContext: { region: 'eu' },
        })

        expect(result).toEqual({ type: 'result', result: { rootCause: 'order o-1 is stuck' } })
        expect(lookupOrder).toHaveBeenCalledWith({ orderId: 'o-1' }, { region: 'eu' })
        expect(model.doGenerateCalls).toHaveLength(2)
        expect(toolResultsSentIn(model.doGenerateCalls[1])).toEqual([
            { type: 'json', value: { orderId: 'o-1', region: 'eu', status: 'stuck' } },
        ])
    })

    it('should send tool failures back to the model instead of failing the investigation', async () => {
        const failingTool = new Tool({
            name: 'flaky',
            description: 'Always fails',
            execute: () => {
                throw new Error('db unavailable')
            },
        })
        const model = useModel(mockToolCallTurn('flaky', {}), finalOutcome('database outage'))

        const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            investigationTools: [failingTool],
        })

        expect(result).toEqual({ type: 'result', result: { rootCause: 'database outage' } })
        expect(JSON.stringify(toolResultsSentIn(model.doGenerateCalls[1]))).toContain('db unavailable')
    })

    it('should stop after maxToolIterations tool rounds', async () => {
        const model = useModel(
            mockToolCallTurn('lookup_order', { orderId: 'o-1' }, 'call-1'),
            mockToolCallTurn('lookup_order', { orderId: 'o-2' }, 'call-2'),
            mockToolCallTurn('lookup_order', { orderId: 'o-3' }, 'call-3'),
        )

        await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            investigationTools: [orderTool],
            maxToolIterations: 1,
        })).rejects.toThrow('Investigation did not reach an outcome within 1 tool iterations')
        expect(model.doGenerateCalls).toHaveLength(2)
    })

    it('should restore redacted tool input and redact tool output', async () => {
        const vault = createVault({ terms: ['secret-order'] })
        const placeholder = String(vault.redact('secret-order'))
        const model = useModel(
            mockToolCallTurn('lookup_order', { orderId: placeholder }),
            finalOutcome('stuck'),
        )

        await investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            investigationTools: [orderTool],
            vault,
        })

        expect(placeholder).not.toBe('secret-order')
        expect(lookupOrder).toHaveBeenCalledWith({ orderId: 'secret-order' }, undefined)
        expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).not.toContain('secret-order')
    })

    it('should abort tools that run past the investigation deadline', async () => {
        const hangingTool = new Tool({
            name: 'hang',
            description: 'Never resolves',
            execute: () => new Promise<never>(() => undefined),
        })
        useModel(mockToolCallTurn('hang', {}), finalOutcome('unreachable'))

        await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 50,
            investigationTools: [hangingTool],
        })).rejects.toThrow('aborted due to timeout')
    })
})
