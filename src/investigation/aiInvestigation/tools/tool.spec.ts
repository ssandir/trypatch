import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod/v4'
import { mockTimeoutSignal } from '../../../test/abort'
import { callTool, defineTool } from './tool'
import type { SchemaInfer } from '../../../schema/types'

type TestContext = {
    value: string
}

const testContext: TestContext = {
    value: 'ctx',
}

describe('defineTool and callTool', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

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

        const execute = jest.fn((input: SchemaInfer<typeof parameters>) => `${input.id}:${input.count}`)

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
        const timeout = mockTimeoutSignal()
        const created = defineTool({
            name: 'slow_tool',
            description: 'Slow tool',
            timeoutMs: 20,
            execute: (): string => 'done',
        })

        await expect(callTool(created, {}, testContext, { signal: undefined }))
            .rejects.toThrow('Tool slow_tool timed out after 20ms')
        expect(timeout).toHaveBeenCalledWith(20)
    })

    it('hands execute a signal that follows the outer signal', async () => {
        const controller = new AbortController()
        let executeSignal: AbortSignal | undefined
        const created = defineTool({
            name: 'signal_tool',
            description: 'Signal tool',
            execute: (_input, _context, { signal }): string => {
                executeSignal = signal
                return 'done'
            },
        })

        await callTool(created, {}, testContext, { signal: controller.signal })
        controller.abort()

        expect(executeSignal?.aborted).toBe(true)
    })
})
