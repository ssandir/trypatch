import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { TrypatchTimeoutError } from '../errors'
import { callTool, defineTool } from './tool'
import type { ToolInputValue } from './types'

type TestContext = {
    value: string
}

const testContext: TestContext = {
    value: 'ctx',
}

describe('defineTool and callTool', () => {
    it('uses the provided tool name', () => {
        const created = defineTool({
            name: 'my_tool',
            description: 'A test tool',
            execute: (): string => 'ok',
        })

        expect(created.name).toBe('my_tool')
    })

    it('passes undefined input when no parameters schema is provided', async () => {
        const execute = jest.fn((): string => 'ok')

        const created = defineTool({
            name: 'no_parameters',
            description: 'No parameters',
            execute,
        })

        await expect(callTool(created, {}, testContext, { signal: undefined })).resolves.toBe('ok')
        expect(execute).toHaveBeenCalledWith(undefined, testContext, { signal: expect.any(AbortSignal) })
    })

    it('validates JSON schema parameters and passes the input to execute', async () => {
        const parameters = {
            type: 'object',
            properties: {
                rootCause: { type: 'string' },
                retryable: { type: 'boolean' },
            },
            required: ['rootCause', 'retryable'],
            additionalProperties: false,
        } as const satisfies JSONSchema

        type InvestigateInput = FromSchema<typeof parameters>

        const execute = jest.fn(({ rootCause, retryable }: InvestigateInput) => ({
            summary: rootCause,
            retryable,
        }))

        const created = defineTool({
            name: 'investigate',
            description: 'Investigate an error',
            parameters,
            execute,
        })

        await expect(callTool(created, {
            rootCause: 'bad input',
            retryable: false,
        }, testContext, { signal: undefined })).resolves.toEqual({
            summary: 'bad input',
            retryable: false,
        })
    })

    it('rejects JSON schema parameters input that fails validation', async () => {
        const parameters = {
            type: 'object',
            properties: {
                rootCause: { type: 'string' },
                retryable: { type: 'boolean' },
            },
            required: ['rootCause', 'retryable'],
            additionalProperties: false,
        } as const satisfies JSONSchema

        const created = defineTool({
            name: 'investigate',
            description: 'Investigate an error',
            parameters,
            execute: (): string => 'ok',
        })

        await expect(callTool(created, {
            rootCause: 'bad input',
        }, testContext, { signal: undefined })).rejects.toThrow(/Invalid parameters/)
    })

    it('parses zod parameters and passes the parsed input to execute', async () => {
        const parameters = z.object({
            id: z.string(),
            count: z.number(),
        })

        const execute = jest.fn((input: ToolInputValue<typeof parameters>) => `${input.id}:${input.count}`)

        const created = defineTool({
            name: 'format_id_and_count',
            description: 'Format id and count',
            parameters,
            execute,
        })

        await expect(callTool(created, { id: 'a', count: 2 }, testContext, { signal: undefined })).resolves.toBe('a:2')
    })

    it('propagates errors from execute', async () => {
        const created = defineTool({
            name: 'always_fails',
            description: 'Always fails',
            execute: (): never => {
                throw new Error('boom')
            },
        })

        await expect(callTool(created, {}, testContext, { signal: undefined })).rejects.toThrow('boom')
    })

    it('rejects when timeoutMs is exceeded', async () => {
        const created = defineTool({
            name: 'slow_tool',
            description: 'Slow tool',
            timeoutMs: 20,
            execute: async (): Promise<string> => {
                await new Promise(resolve => setTimeout(resolve, 100))
                return 'done'
            },
        })

        await expect(callTool(created, {}, testContext, { signal: undefined })).rejects.toThrow(TrypatchTimeoutError)
    })

    it('aborts the signal execute sees when timeoutMs is exceeded', async () => {
        let executeSignal: AbortSignal | undefined
        const created = defineTool({
            name: 'slow_tool',
            description: 'Slow tool',
            timeoutMs: 20,
            execute: (_input, _context, { signal }): Promise<never> => {
                executeSignal = signal
                return new Promise<never>(() => undefined)
            },
        })

        const error = await callTool(created, {}, testContext, { signal: undefined }).catch((caught: unknown) => caught)

        expect(error).toHaveProperty('message', 'Tool slow_tool timed out after 20ms')
        expect(error).toBeInstanceOf(TrypatchTimeoutError)
        expect(executeSignal?.aborted).toBe(true)
    })

    it('rejects with the outer abort reason and aborts the signal execute sees', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        let executeSignal: AbortSignal | undefined
        const created = defineTool({
            name: 'hanging_tool',
            description: 'Hanging tool',
            timeoutMs: 5_000,
            execute: (_input, _context, { signal }): Promise<never> => {
                executeSignal = signal
                return new Promise<never>(() => undefined)
            },
        })
        setTimeout(() => {
            controller.abort(reason)
        }, 20)

        await expect(callTool(created, {}, testContext, { signal: controller.signal })).rejects.toBe(reason)
        expect(executeSignal?.aborted).toBe(true)
    })
})
