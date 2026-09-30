import { z } from 'zod'
import { Logger } from '../../logger'
import type { InvestigationContext } from '../../types'
import { buildInvestigationPrompt } from './buildPrompt'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithLanguageModel } from './providers/languageModel/investigate'
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
                { timeoutMs: 5_000 },
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

        it('should pass MCP servers to cursor with header functions resolved', async () => {
            await investigateWithCursor(
                { provider: 'cursor', apiKey: 'cursor-key' },
                outcomeSchema,
                { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                {
                    timeoutMs: 5_000,
                    mcpServers: [
                        { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', headers: () => ({ Authorization: 'Bearer token' }) },
                        { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'gh' }, cwd: '/ignored' },
                    ],
                },
            )

            const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>
            expect(body['mcpServers']).toEqual([
                { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer token' } },
                { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'gh' } },
            ])
        })

        it('should drop an MCP server whose headers fail to resolve and tell the agent', async () => {
            const warn = jest.fn()

            await investigateWithCursor(
                { provider: 'cursor', apiKey: 'cursor-key' },
                outcomeSchema,
                { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                {
                    timeoutMs: 5_000,
                    mcpServers: [{
                        name: 'linear',
                        type: 'http',
                        url: 'https://mcp.linear.app/mcp',
                        headers: () => Promise.reject(new Error('vault sealed')),
                    }],
                    logger: new Logger({ logger: { ...console, warn } }),
                },
            )

            const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as { prompt: { text: string }, mcpServers?: unknown }
            expect(body.mcpServers).toBeUndefined()
            expect(body.prompt.text).toContain('- linear: vault sealed')
            expect(warn).toHaveBeenCalledWith('[ssandir/trypatch] MCP server "linear" unavailable:', expect.any(Error))
        })
    })

    describe('investigateWithLanguageModel', () => {
        const outcomeSchema = buildInvestigationResultSchema({
            resultSchema: z.object({ rootCause: z.string(), retryable: z.boolean() }),
        })
        const outcomeText = JSON.stringify({
            outcome: { type: 'result', result: { rootCause: 'rate limited', retryable: true } },
        })
        const prompts = { systemPrompt: 'Investigate', userPrompt: 'Something failed' }

        const fetchMock = jest.fn()

        afterEach(() => {
            fetchMock.mockReset()
        })

        function jsonResponse (body: unknown): Response {
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        }

        function requestBody (callIndex = 0): Record<string, unknown> {
            return JSON.parse(String((fetchMock.mock.calls[callIndex] as [string, RequestInit])[1].body)) as Record<string, unknown>
        }

        it('should call Claude through the custom fetch and return the parsed outcome', async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'claude-sonnet-5',
                content: [{ type: 'text', text: outcomeText }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 10 },
            }))

            const result = await investigateWithLanguageModel(
                { provider: 'claude', apiKey: 'anthropic-key', fetch: fetchMock },
                outcomeSchema,
                prompts,
                { timeoutMs: 5_000 },
            )

            expect(result).toEqual({
                type: 'result',
                result: { rootCause: 'rate limited', retryable: true },
            })
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({ 'x-api-key': 'anthropic-key' }),
                }),
            )
            expect(requestBody().model).toBe('claude-sonnet-5')
        })

        it('should call OpenAI through the custom fetch and return the parsed outcome', async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                id: 'resp_1',
                object: 'response',
                created_at: 1,
                model: 'gpt-5.5',
                output: [{
                    type: 'message',
                    id: 'msg_1',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: outcomeText, annotations: [] }],
                }],
                usage: { input_tokens: 10, output_tokens: 10 },
            }))

            const result = await investigateWithLanguageModel(
                { provider: 'openai', apiKey: 'test-key', fetch: fetchMock },
                outcomeSchema,
                prompts,
                { timeoutMs: 5_000 },
            )

            expect(result).toEqual({
                type: 'result',
                result: { rootCause: 'rate limited', retryable: true },
            })
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.openai.com/v1/responses',
                expect.objectContaining({
                    headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
                }),
            )
        })

        it('should call an OpenAI-compatible endpoint at its base URL', async () => {
            fetchMock.mockResolvedValue(jsonResponse({
                id: 'chatcmpl-1',
                object: 'chat.completion',
                created: 1,
                model: 'llama',
                choices: [{ index: 0, message: { role: 'assistant', content: outcomeText }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 10 },
            }))

            const result = await investigateWithLanguageModel(
                {
                    provider: 'openai-compatible',
                    baseURL: 'http://localhost:11434/v1',
                    model: 'llama',
                    supportsStructuredOutputs: true,
                    fetch: fetchMock,
                },
                outcomeSchema,
                prompts,
                { timeoutMs: 5_000 },
            )

            expect(result.type).toBe('result')
            expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything())
        })
    })
})
