import process from 'node:process'
import { z } from 'zod'
import { Tool } from '../tools'
import type { InvestigationContext, TryPatchOptions } from '../trypatchOptions'
import { mockMethodDecoratorContext } from '../test/mockMethodDecoratorContext'
import { buildInvestigationPrompt } from './buildPrompt'
import { buildInvestigationContext, investigateError } from './investigate'
import { defaultAuthVariable, resolveApiKey } from './resolveApiKey'
import { extractJsonFromText, toJsonSchemaObject } from '../schema/utils'
import { parseInvestigationResult } from './providers/parseResult'
import { investigateWithOpenAi } from './providers/openai'
import { investigateWithCursor } from './providers/cursor'

describe('resolveApiKey', () => {
    it('should resolve inline auth', async () => {
        await expect(resolveApiKey({ kind: 'inline', apiKey: 'test-key' })).resolves.toBe('test-key')
    })

    it('should resolve env auth', async () => {
        process.env.TEST_TRYPATCH_API_KEY = 'env-key'
        await expect(resolveApiKey({ kind: 'env', variable: 'TEST_TRYPATCH_API_KEY' })).resolves.toBe('env-key')
        delete process.env.TEST_TRYPATCH_API_KEY
    })

    it('should throw when env auth is missing', async () => {
        await expect(resolveApiKey({ kind: 'env', variable: 'MISSING_TRYPATCH_API_KEY' }))
            .rejects
            .toThrow('Missing environment variable: MISSING_TRYPATCH_API_KEY')
    })
})

describe('defaultAuthVariable', () => {
    it('should map providers to default env vars', () => {
        expect(defaultAuthVariable('openai')).toBe('OPENAI_API_KEY')
        expect(defaultAuthVariable('cursor')).toBe('CURSOR_API_KEY')
    })
})

describe('schemaUtils', () => {
    const schema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    it('should convert zod schemas to json schema objects', () => {
        const jsonSchema = toJsonSchemaObject(schema)
        expect(jsonSchema).toMatchObject({
            type: 'object',
            properties: {
                rootCause: { type: 'string' },
                retryable: { type: 'boolean' },
            },
        })
    })

    it('should parse zod investigation results', () => {
        expect(parseInvestigationResult(schema, { rootCause: 'timeout', retryable: true })).toEqual({
            rootCause: 'timeout',
            retryable: true,
        })
    })

    it('should extract json from fenced text', () => {
        expect(extractJsonFromText('```json\n{"rootCause":"x","retryable":false}\n```')).toEqual({
            rootCause: 'x',
            retryable: false,
        })
    })
})

describe('buildInvestigationPrompt', () => {
    const schema = z.object({ rootCause: z.string() })
    const ctx: InvestigationContext = {
        error: new Error('boom'),
        methodName: 'charge',
        args: ['card-1'],
        sanitizedArgs: ['card-1'],
    }

    it('should include method and error details in the default prompt', () => {
        const prompts = buildInvestigationPrompt(ctx, schema, {})
        expect(prompts.userPrompt).toContain('Method: charge')
        expect(prompts.userPrompt).toContain('boom')
        expect(prompts.userPrompt).toContain('rootCause')
    })
})

describe('investigateWithOpenAi', () => {
    const schema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    const fetchMock = jest.fn()

    beforeAll(() => {
        globalThis.fetch = fetchMock
    })

    beforeEach(() => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ rootCause: 'network timeout', retryable: true }),
                        },
                    },
                ],
            }),
        })
    })

    afterEach(() => {
        fetchMock.mockReset()
    })

    it('should call OpenAI and return parsed investigation results', async () => {
        const result = await investigateWithOpenAi(
            {
                provider: 'openai',
                auth: { kind: 'inline', apiKey: 'test-key' },
            },
            schema,
            {
                systemPrompt: 'Investigate',
                userPrompt: 'Something failed',
            },
            5_000,
            undefined,
            undefined,
            undefined,
        )

        expect(result).toEqual({
            kind: 'result',
            result: { rootCause: 'network timeout', retryable: true },
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.openai.com/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer test-key',
                }),
            }),
        )
    })
})

describe('investigateWithCursor', () => {
    const schema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    const fetchMock = jest.fn()

    beforeAll(() => {
        globalThis.fetch = fetchMock
    })

    beforeEach(() => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    agent: { id: 'bc-agent' },
                    run: { id: 'run-1' },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    status: 'FINISHED',
                    result: '{"rootCause":"invalid payload","retryable":false}',
                }),
            })
    })

    afterEach(() => {
        fetchMock.mockReset()
    })

    it('should create a cursor agent and poll until finished', async () => {
        const result = await investigateWithCursor(
            {
                provider: 'cursor',
                auth: { kind: 'inline', apiKey: 'cursor-key' },
            },
            schema,
            {
                systemPrompt: 'Investigate',
                userPrompt: 'Something failed',
            },
            5_000,
        )

        expect(result).toEqual({
            kind: 'result',
            result: { rootCause: 'invalid payload', retryable: false },
        })
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            'https://api.cursor.com/v1/agents',
            expect.objectContaining({ method: 'POST' }),
        )
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            'https://api.cursor.com/v1/agents/bc-agent/runs/run-1',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: 'Basic Y3Vyc29yLWtleTo=',
                }),
            }),
        )
    })
})

describe('investigateError', () => {
    it('should use custom investigate override when provided', async () => {
        const options: TryPatchOptions = {
            investigate: () => Promise.resolve({ rootCause: 'custom' }),
        }

        const result = await investigateError(
            buildInvestigationContext(new Error('x'), mockMethodDecoratorContext(), []),
            options,
        )

        expect(result).toEqual({ rootCause: 'custom' })
    })

    it('should invoke result tools when the provider returns a result-tool result', async () => {
        const schema = z.object({
            rootCause: z.string(),
            retryable: z.boolean(),
        })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDecoratorContext(), [])
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                {
                                    function: {
                                        name: 'submit_investigation',
                                        arguments: JSON.stringify({ rootCause: 'network', retryable: true }),
                                    },
                                },
                            ],
                        },
                    },
                ],
            }),
        })

        globalThis.fetch = fetchMock

        const resultTool = new Tool({
            name: 'submit_investigation',
            description: 'Submit the final investigation result',
            parameters: schema,
            execute: (input: z.infer<typeof schema>): z.infer<typeof schema> => input,
        })

        const result = await investigateError(ctx, {
            resultSchema: schema,
            investigationProvider: {
                provider: 'openai',
                auth: { kind: 'inline', apiKey: 'test-key' },
            },
            resultTools: [resultTool],
        })

        expect(result).toEqual({ rootCause: 'network', retryable: true })
    })

    it('should redact investigation prompts before calling the provider', async () => {
        const schema = z.object({
            rootCause: z.string(),
            retryable: z.boolean(),
        })
        const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
        const ctx = buildInvestigationContext(
            new Error(`request failed with ${secret}`),
            mockMethodDecoratorContext('charge'),
            [{ authorization: secret }],
        )
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ rootCause: 'invalid token', retryable: false }),
                        },
                    },
                ],
            }),
        })

        globalThis.fetch = fetchMock

        await investigateError(ctx, {
            resultSchema: schema,
            investigationProvider: {
                provider: 'openai',
                auth: { kind: 'inline', apiKey: 'test-key' },
            },
            redactConfig: {},
        })

        const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
            messages: { role: string, content: string }[]
        }
        const userPrompt = fetchBody.messages.find(message => message.role === 'user')?.content ?? ''

        expect(userPrompt).not.toContain(secret)
        expect(userPrompt).toContain('charge')
    })
})
