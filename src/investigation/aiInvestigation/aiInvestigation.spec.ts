import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { Logger } from '../../logger'
import { mockTimeoutSignal } from '../../test/abort'
import type { InvestigationContext } from '../../types'
import { buildInvestigationPrompt } from './buildPrompt'
import { CANCEL_TIMEOUT_MS } from './providers/cursor/constants'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithLanguageModel } from './providers/languageModel/investigate'
import { buildInvestigationResultSchema, outcomeSchemaPrompt } from './resultSchema'

jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }))

function jsonResponse (body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })
}

function requestBody (fetchMock: jest.MockedFunction<typeof fetch>, callIndex = 0): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[callIndex]?.[1]?.body as string) as Record<string, unknown>
}

describe('aiInvestigation', () => {
    describe('buildInvestigationPrompt', () => {
        const ctx: InvestigationContext = {
            error: new Error('boom'),
            methodName: 'charge',
            methodSource: 'charge(cardId) { return this.gateway.charge(cardId) }',
            args: ['card-1'],
            methodMetadata: { static: false, private: false },
            timing: { startedAt: new Date('2026-10-09T08:15:00.000Z'), durationMs: 30_012 },
        }

        it('should include method and error details but not the outcome schema in the default prompt', () => {
            const prompts = buildInvestigationPrompt(ctx, ctx.args, {})
            expect(prompts.userPrompt).toContain('Method: charge')
            expect(prompts.userPrompt).toContain('boom')
            expect(prompts.userPrompt).not.toContain('Return JSON matching this schema')
        })

        it('should include class name and method metadata in the default prompt', () => {
            const prompts = buildInvestigationPrompt({
                ...ctx,
                methodMetadata: { className: 'BillingService', static: true, private: true },
            }, ctx.args, {})
            expect(prompts.userPrompt).toContain('Method: BillingService.charge')
            expect(prompts.userPrompt).toContain('Method metadata: {"className":"BillingService","static":true,"private":true}')
        })

        it('should include when the call started and how long it ran', () => {
            expect(buildInvestigationPrompt(ctx, ctx.args, {}).userPrompt)
                .toContain('Call started at 2026-10-09T08:15:00.000Z and failed after 30012 ms')
        })

        it('should pass sanitized args to a custom prompt function', () => {
            const prompt = jest.fn((promptCtx: InvestigationContext) => `args: ${String(promptCtx.args)}`)

            const prompts = buildInvestigationPrompt(ctx, ['card-****'], { prompt })

            expect(prompts.userPrompt).toBe('args: card-****')
            expect(prompt).toHaveBeenCalledWith({ ...ctx, args: ['card-****'] })
        })

        it('should leave the method source out of the default prompt unless allowMethodSource is set', () => {
            expect(buildInvestigationPrompt(ctx, ctx.args, {}).userPrompt)
                .not.toContain(ctx.methodSource)
            expect(buildInvestigationPrompt(ctx, ctx.args, { allowMethodSource: true }).userPrompt)
                .toContain(`Method source (as loaded at runtime, so it may be compiled or minified):\n${ctx.methodSource}`)
        })
    })

    describe('investigateWithCursor', () => {
        const outcomeSchema = buildInvestigationResultSchema({
            resultSchema: z.object({ inStock: z.boolean() }),
        })

        const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn()

        beforeAll(() => {
            globalThis.fetch = fetchMock
        })

        beforeEach(() => {
            fetchMock
                .mockResolvedValueOnce(jsonResponse({
                    agent: { id: 'bc-agent' },
                    run: { id: 'run-1' },
                }))
                .mockResolvedValueOnce(jsonResponse({
                    status: 'FINISHED',
                    result: JSON.stringify({
                        outcome: { type: 'result', explanation: 'test explanation', result: { inStock: false } },
                    }),
                }))
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
                {},
            )

            expect(result).toEqual({
                type: 'result',
                explanation: 'test explanation',
                result: { inStock: false },
            })
            expect(fetchMock).toHaveBeenNthCalledWith(
                1,
                'https://api.cursor.com/v1/agents',
                expect.objectContaining({ method: 'POST' }),
            )
            expect((requestBody(fetchMock).prompt as { text: string }).text)
                .toBe(`Investigate\n\nSomething failed\n\n${outcomeSchemaPrompt(outcomeSchema)}`)
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
                    mcpServers: [
                        { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', headers: () => ({ Authorization: 'Bearer token' }) },
                        { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'gh' }, cwd: '/ignored' },
                    ],
                },
            )

            expect(requestBody(fetchMock).mcpServers).toEqual([
                { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer token' } },
                { name: 'github', type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: 'gh' } },
            ])
        })

        it('should drop an MCP server whose headers fail to resolve', async () => {
            const warn = jest.fn()

            await investigateWithCursor(
                { provider: 'cursor', apiKey: 'cursor-key' },
                outcomeSchema,
                { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                {
                    mcpServers: [{
                        name: 'linear',
                        type: 'http',
                        url: 'https://mcp.linear.app/mcp',
                        headers: () => Promise.reject(new Error('vault sealed')),
                    }],
                    logger: new Logger({ logger: { ...console, warn } }),
                },
            )

            expect(requestBody(fetchMock).mcpServers).toBeUndefined()
            expect(warn).toHaveBeenCalledWith('[ssandir/trypatch] MCP server "linear" is unavailable and was skipped', expect.any(Error))
        })

        describe('aborting', () => {
            afterEach(() => {
                jest.restoreAllMocks()
            })

            // The caller has aborted by the time we poll, so the poll fails like `fetch` does on abort.
            function useAbortedPoll (): void {
                fetchMock.mockReset()
                fetchMock
                    .mockResolvedValueOnce(jsonResponse({ agent: { id: 'bc-agent' }, run: { id: 'run-1' } }))
                    .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
            }

            it('should pass the signal to every fetch', async () => {
                const controller = new AbortController()

                await investigateWithCursor(
                    { provider: 'cursor', apiKey: 'cursor-key' },
                    outcomeSchema,
                    { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                    { signal: controller.signal },
                )

                const signals = fetchMock.mock.calls.map(([, init]) => init?.signal)
                expect(signals).toHaveLength(2)
                expect(signals.every(signal => signal instanceof AbortSignal)).toBe(true)
                controller.abort()
                expect(signals.every(signal => signal?.aborted)).toBe(true)
            })

            it('should wait pollIntervalMs between polls under the caller signal', async () => {
                fetchMock.mockReset()
                fetchMock
                    .mockResolvedValueOnce(jsonResponse({ agent: { id: 'bc-agent' }, run: { id: 'run-1' } }))
                    .mockResolvedValueOnce(jsonResponse({ status: 'RUNNING' }))
                    .mockResolvedValueOnce(jsonResponse({
                        status: 'FINISHED',
                        result: JSON.stringify({
                            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: false } },
                        }),
                    }))
                const controller = new AbortController()

                await investigateWithCursor(
                    { provider: 'cursor', apiKey: 'cursor-key', pollIntervalMs: 60_000 },
                    outcomeSchema,
                    { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                    { signal: controller.signal },
                )

                expect(sleep).toHaveBeenCalledWith(60_000, undefined, { signal: controller.signal })
            })

            it('should cancel the remote run under its own timeout when the caller aborts', async () => {
                useAbortedPoll()
                fetchMock.mockResolvedValueOnce(jsonResponse({}))
                const timeout = mockTimeoutSignal()

                await expect(investigateWithCursor(
                    { provider: 'cursor', apiKey: 'cursor-key' },
                    outcomeSchema,
                    { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                    { signal: AbortSignal.abort(new Error('cancelled')) },
                )).rejects.toThrow('aborted')

                const [url, init] = fetchMock.mock.lastCall ?? []
                expect(url).toBe('https://api.cursor.com/v1/agents/bc-agent/runs/run-1/cancel')
                expect(init?.method).toBe('POST')
                expect(timeout).toHaveBeenCalledWith(CANCEL_TIMEOUT_MS)
                expect(init?.signal).toBe(timeout.mock.results[0]?.value)
            })

            it('should still rethrow the abort and log a warning when cancelling the remote run fails', async () => {
                useAbortedPoll()
                fetchMock.mockRejectedValueOnce(new Error('network down'))
                const warn = jest.fn()

                await expect(investigateWithCursor(
                    { provider: 'cursor', apiKey: 'cursor-key' },
                    outcomeSchema,
                    { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                    { signal: AbortSignal.abort(new Error('cancelled')), logger: new Logger({ logger: { ...console, warn } }) },
                )).rejects.toThrow('aborted')

                expect(warn).toHaveBeenCalledWith(
                    '[ssandir/trypatch] Cursor run run-1 could not be cancelled and may keep running remotely',
                    expect.any(Error),
                )
            })

            it('should not cancel the remote run when the investigation fails without an abort', async () => {
                fetchMock.mockReset()
                fetchMock
                    .mockResolvedValueOnce(jsonResponse({ agent: { id: 'bc-agent' }, run: { id: 'run-1' } }))
                    .mockResolvedValueOnce(jsonResponse({ status: 'ERROR' }))

                await expect(investigateWithCursor(
                    { provider: 'cursor', apiKey: 'cursor-key' },
                    outcomeSchema,
                    { systemPrompt: 'Investigate', userPrompt: 'Something failed' },
                    { signal: new AbortController().signal },
                )).rejects.toThrow('ended with status ERROR')

                expect(fetchMock).toHaveBeenCalledTimes(2)
            })
        })
    })

    describe('investigateWithLanguageModel', () => {
        const outcomeSchema = buildInvestigationResultSchema({
            resultSchema: z.object({ inStock: z.boolean() }),
        })
        const outcomeText = JSON.stringify({
            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: true } },
        })
        const prompts = { systemPrompt: 'Investigate', userPrompt: 'Something failed' }

        const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn()

        afterEach(() => {
            fetchMock.mockReset()
        })

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
                {},
            )

            expect(result).toEqual({
                type: 'result',
                explanation: 'test explanation',
                result: { inStock: true },
            })
            expect(fetchMock).toHaveBeenCalledWith(
                'https://api.anthropic.com/v1/messages',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({ 'x-api-key': 'anthropic-key' }),
                }),
            )
            expect(requestBody(fetchMock).model).toBe('claude-sonnet-5')
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
                {},
            )

            expect(result).toEqual({
                type: 'result',
                explanation: 'test explanation',
                result: { inStock: true },
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
                {},
            )

            expect(result.type).toBe('result')
            expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything())
        })
    })
})
