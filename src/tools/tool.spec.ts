import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { Tool } from './tool'
import type { ToolInputValue } from './types'

type TestContext = {
    value: string
}

const testContext: TestContext = {
    value: 'ctx',
}

describe('Tool', () => {
    it('uses the provided tool name', () => {
        const created = new Tool({
            name: 'my_tool',
            description: 'A test tool',
            execute: (): string => 'ok',
        })

        expect(created.name).toBe('my_tool')
        expect(created).toBeInstanceOf(Tool)
    })

    it('passes raw string input when no parameters schema is provided', async () => {
        const execute = jest.fn((input: string) => input.toUpperCase())

        const created = new Tool({
            name: 'uppercase_input',
            description: 'Uppercase input',
            execute,
        })

        await expect(created.call('hello', testContext)).resolves.toBe('HELLO')
        expect(execute).toHaveBeenCalledWith('hello', testContext)
        expect(created.parameters).toEqual({
            type: 'object',
            properties: {},
        })
    })

    it('parses JSON schema parameters and passes typed input to execute', async () => {
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

        const execute = jest.fn((input: unknown) => {
            const { rootCause, retryable } = input as InvestigateInput
            return {
                summary: rootCause,
                retryable,
            }
        })

        const created = new Tool({
            name: 'investigate',
            description: 'Investigate an error',
            parameters,
            execute,
        })

        await expect(created.call(JSON.stringify({
            rootCause: 'bad input',
            retryable: false,
        }), testContext)).resolves.toEqual({
            summary: 'bad input',
            retryable: false,
        })
    })

    it('rejects malformed JSON for JSON schema parameters', async () => {
        const parameters = {
            type: 'object',
            properties: {
                rootCause: { type: 'string' },
            },
            required: ['rootCause'],
            additionalProperties: false,
        } as const satisfies JSONSchema

        const created = new Tool({
            name: 'investigate',
            description: 'Investigate an error',
            parameters,
            execute: (): string => 'ok',
        })

        await expect(created.call('not-json', testContext)).rejects.toThrow(/Invalid JSON input/)
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

        const created = new Tool({
            name: 'investigate',
            description: 'Investigate an error',
            parameters,
            execute: (): string => 'ok',
        })

        await expect(created.call(JSON.stringify({
            rootCause: 'bad input',
        }), testContext)).rejects.toThrow(/Invalid parameters/)
    })

    it('parses zod parameters and passes typed input to execute', async () => {
        const parameters = z.object({
            id: z.string(),
            count: z.number(),
        })

        const execute = jest.fn((input: ToolInputValue<typeof parameters>) => `${input.id}:${input.count}`)

        const created = new Tool({
            name: 'format_id_and_count',
            description: 'Format id and count',
            parameters,
            execute,
        })

        await expect(created.call(JSON.stringify({ id: 'a', count: 2 }), testContext)).resolves.toBe('a:2')
    })

    it('propagates errors from execute', async () => {
        const created = new Tool({
            name: 'always_fails',
            description: 'Always fails',
            execute: (): never => {
                throw new Error('boom')
            },
        })

        await expect(created.call('input', testContext)).rejects.toThrow('boom')
    })

    it('rejects when timeoutMs is exceeded', async () => {
        const created = new Tool({
            name: 'slow_tool',
            description: 'Slow tool',
            timeoutMs: 20,
            execute: async (): Promise<string> => {
                await new Promise(resolve => setTimeout(resolve, 100))
                return 'done'
            },
        })

        await expect(created.call('input', testContext)).rejects.toThrow(/timed out/)
    })
})
