import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod/v4'
import { Logger } from '../../../../logger'
import { mockTimeoutSignal } from '../../../../test/abort'
import { jsonResponse, requestBody } from '../../../../test/fetch'
import { buildInvestigationResultSchema, outcomeSchemaPrompt } from '../../resultSchema'
import { CANCEL_TIMEOUT_MS } from './constants'
import { investigateWithCursor } from './investigate'

jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }))

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
            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: false } },
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
