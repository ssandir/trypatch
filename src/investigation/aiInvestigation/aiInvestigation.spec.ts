import { z } from 'zod'
import { Tool } from '../../tools'
import type { InvestigationContext } from '../../types'
import { buildInvestigationPrompt } from './buildPrompt'
import { investigateWithOpenAi } from './providers/openai/investigate'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithClaude } from './providers/claude/investigate'
import { buildInvestigationResultSchema } from './resultSchema'

describe('aiInvestigation', () => {
    describe('buildInvestigationPrompt', () => {
        const schema = z.object({ rootCause: z.string() })
        const ctx: InvestigationContext = {
            error: new Error('boom'),
            methodName: 'charge',
            args: ['card-1'],
            methodMetadata: { static: false, private: false },
        }

        it('should include method, error, and outcome schema details in the default prompt', () => {
            const outcomeSchema = buildInvestigationResultSchema({ resultSchema: schema })
            const prompts = buildInvestigationPrompt(ctx, ctx.args, outcomeSchema, {})
            expect(prompts.userPrompt).toContain('Method: charge')
            expect(prompts.userPrompt).toContain('boom')
            expect(prompts.userPrompt).toContain('rootCause')
        })

        it('should include class name and method metadata in the default prompt', () => {
            const outcomeSchema = buildInvestigationResultSchema({ resultSchema: schema })
            const prompts = buildInvestigationPrompt({
                ...ctx,
                methodMetadata: { className: 'BillingService', static: true, private: true },
            }, ctx.args, outcomeSchema, {})
            expect(prompts.userPrompt).toContain('Method: BillingService.charge')
            expect(prompts.userPrompt).toContain('Method metadata: {"className":"BillingService","static":true,"private":true}')
        })
    })

    describe('investigateWithOpenAi', () => {
        const schema = z.object({
            rootCause: z.string(),
            retryable: z.boolean(),
        })
        const outcomeSchema = buildInvestigationResultSchema({ resultSchema: schema })

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
                                content: JSON.stringify({
                                    outcome: { type: 'result', result: { rootCause: 'network timeout', retryable: true } },
                                }),
                            },
                        },
                    ],
                }),
            })
        })

        afterEach(() => {
            fetchMock.mockReset()
        })

        it('should call OpenAI and return the parsed outcome', async () => {
            const result = await investigateWithOpenAi(
                {
                    provider: 'openai',
                    apiKey: 'test-key',
                },
                outcomeSchema,
                {
                    systemPrompt: 'Investigate',
                    userPrompt: 'Something failed',
                },
                5_000,
                undefined,
                undefined,
            )

            expect(result).toEqual({
                type: 'result',
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

            const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
                response_format: { type: string }
            }
            expect(fetchBody.response_format.type).toBe('json_schema')
        })

        it('should use a custom fetch implementation instead of the global one', async () => {
            const customFetch = jest.fn((url: string, init?: RequestInit) => fetchMock(
                `https://proxy.internal/relay?target=${encodeURIComponent(url)}`,
                { ...init, headers: { ...init?.headers, 'X-Proxy-Token': 'proxy-secret' } },
            )) as unknown as typeof fetch

            await investigateWithOpenAi(
                {
                    provider: 'openai',
                    apiKey: 'test-key',
                    fetch: customFetch,
                },
                outcomeSchema,
                {
                    systemPrompt: 'Investigate',
                    userPrompt: 'Something failed',
                },
                5_000,
                undefined,
                undefined,
            )

            expect(customFetch).toHaveBeenCalled()
            expect(fetchMock).toHaveBeenCalledWith(
                'https://proxy.internal/relay?target=https%3A%2F%2Fapi.openai.com%2Fv1%2Fchat%2Fcompletions',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer test-key',
                        'X-Proxy-Token': 'proxy-secret',
                    }),
                }),
            )
        })
    })

    describe('investigateWithCursor', () => {
        const outcomeSchema = buildInvestigationResultSchema({
            resultSchema: z.object({ rootCause: z.string(), retryable: z.boolean() }),
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
                        result: JSON.stringify({
                            outcome: { type: 'result', result: { rootCause: 'invalid payload', retryable: false } },
                        }),
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
                    apiKey: 'cursor-key',
                },
                outcomeSchema,
                {
                    systemPrompt: 'Investigate',
                    userPrompt: 'Something failed',
                },
                5_000,
            )

            expect(result).toEqual({
                type: 'result',
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

    describe('investigateWithClaude', () => {
        const schema = z.object({
            rootCause: z.string(),
            retryable: z.boolean(),
        })
        const outcomeSchema = buildInvestigationResultSchema({ resultSchema: schema })

        const fetchMock = jest.fn()

        beforeAll(() => {
            globalThis.fetch = fetchMock
        })

        afterEach(() => {
            fetchMock.mockReset()
        })

        it('should call Claude and return the parsed outcome', async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                outcome: { type: 'result', result: { rootCause: 'rate limited', retryable: true } },
                            }),
                        },
                    ],
                }),
            })

            const result = await investigateWithClaude(
                {
                    provider: 'claude',
                    apiKey: 'anthropic-key',
                },
                outcomeSchema,
                {
                    systemPrompt: 'Investigate',
                    userPrompt: 'Something failed',
                },
                5_000,
                undefined,
                undefined,
            )

            expect(result).toEqual({
                type: 'result',
                result: { rootCause: 'rate limited', retryable: true },
            })
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'x-api-key': 'anthropic-key',
                        'anthropic-version': '2023-06-01',
                    }),
                }),
            )

            const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
                model: string
                max_tokens: number
                output_config: { format: { type: string } }
            }
            expect(fetchBody.model).toBe('claude-sonnet-5')
            expect(fetchBody.max_tokens).toBe(16_000)
            expect(fetchBody.output_config.format.type).toBe('json_schema')
        })

        it('should return a resultTool outcome when Claude selects that outcome branch', async () => {
            const resultTool = new Tool({
                name: 'submit_investigation',
                description: 'Submit the final investigation result',
                parameters: schema,
                execute: (input: z.infer<typeof schema>): z.infer<typeof schema> => input,
            })
            const outcomeSchemaWithResultTool = buildInvestigationResultSchema({ resultSchema: schema, resultTools: [resultTool] })

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                outcome: {
                                    type: 'resultTool',
                                    toolName: 'submit_investigation',
                                    input: { rootCause: 'timeout', retryable: true },
                                },
                            }),
                        },
                    ],
                }),
            })

            const result = await investigateWithClaude(
                {
                    provider: 'claude',
                    apiKey: 'anthropic-key',
                },
                outcomeSchemaWithResultTool,
                {
                    systemPrompt: 'Investigate',
                    userPrompt: 'Something failed',
                },
                5_000,
                256,
                undefined,
            )

            expect(result).toEqual({
                type: 'resultTool',
                toolName: 'submit_investigation',
                input: { rootCause: 'timeout', retryable: true },
            })
        })
    })
})
