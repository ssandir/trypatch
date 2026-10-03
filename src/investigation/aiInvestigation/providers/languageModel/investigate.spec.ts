import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { jsonSchema, tool, type ToolSet } from 'ai'
import { createVault } from 'flare-redact'
import { z } from 'zod'
import {
    mockLanguageModel,
    mockOutcomeTurn,
    mockToolCallTurn,
    type MockCallOptions,
    type MockGenerateResult,
} from '../../../../test/mockLanguageModel'
import { TrypatchTimeoutError } from '../../../../errors'
import { Logger } from '../../../../logger'
import { Tool } from '../../../../tools'
import { buildInvestigationResultSchema } from '../../resultSchema'
import { createLanguageModel } from './createLanguageModel'
import { investigateWithLanguageModel } from './investigate'

jest.mock('./createLanguageModel')
jest.mock('@ai-sdk/mcp', () => ({ createMCPClient: jest.fn() }))
jest.mock('@ai-sdk/mcp/mcp-stdio', () => ({ Experimental_StdioMCPTransport: jest.fn() }))

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
        })).rejects.toThrow(TrypatchTimeoutError)
    })

    it('should abort the investigation when the caller signal fires before the deadline', async () => {
        const hangingTool = new Tool({
            name: 'hang',
            description: 'Never resolves',
            execute: () => new Promise<never>(() => undefined),
        })
        useModel(mockToolCallTurn('hang', {}), finalOutcome('unreachable'))
        const controller = new AbortController()
        setTimeout(() => {
            controller.abort(new Error('cancelled'))
        }, 20)

        await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            investigationTools: [hangingTool],
            signal: controller.signal,
        })).rejects.toThrow('cancelled')
    })

    it('should not call the model when the caller signal is already aborted', async () => {
        const model = useModel(finalOutcome('unreachable'))

        await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
            timeoutMs: 5_000,
            signal: AbortSignal.abort(new Error('cancelled')),
        })).rejects.toThrow('cancelled')
        expect(model.doGenerateCalls).toHaveLength(0)
    })
    describe('mcpServers', () => {
        const warn = jest.fn()
        const logger = new Logger({ logger: { ...console, warn } })
        const queryLogs = jest.fn((input: { query: string }) => ({ lines: [`log for ${input.query}`] }))

        function mcpTools (): ToolSet {
            return {
                query_logs: tool({
                    description: 'Query logs',
                    inputSchema: jsonSchema<{ query: string }>({
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query'],
                    }),
                    execute: queryLogs,
                }),
                delete_dashboard: tool({
                    description: 'Delete a dashboard',
                    inputSchema: jsonSchema({ type: 'object', properties: {} }),
                    execute: () => ({ deleted: true }),
                }),
            }
        }

        function mockClient (tools: ToolSet = mcpTools()): MCPClient & { close: jest.Mock } {
            return { tools: jest.fn().mockResolvedValue(tools), close: jest.fn().mockResolvedValue(undefined) } as unknown as MCPClient & { close: jest.Mock }
        }

        const grafana = { name: 'grafana', type: 'http', url: 'https://mcp.internal/grafana' } as const

        it('should expose prefixed MCP tools filtered by allowedTools and close the client', async () => {
            const client = mockClient()
            jest.mocked(createMCPClient).mockResolvedValue(client)
            const model = useModel(
                mockToolCallTurn('grafana__query_logs', { query: 'checkout' }),
                finalOutcome('checkout timed out'),
            )

            const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                investigationTools: [orderTool],
                mcpServers: [{ ...grafana, headers: { Authorization: 'Bearer t' }, allowedTools: ['query_logs'] }],
                logger,
            })

            expect(result).toEqual({ type: 'result', result: { rootCause: 'checkout timed out' } })
            expect(model.doGenerateCalls[0]?.tools?.map(sentTool => sentTool.name)).toEqual(['lookup_order', 'grafana__query_logs'])
            expect(queryLogs).toHaveBeenCalledWith({ query: 'checkout' }, expect.anything())
            expect(jest.mocked(createMCPClient)).toHaveBeenCalledWith(expect.objectContaining({
                transport: expect.objectContaining({ type: 'http', url: grafana.url, headers: { Authorization: 'Bearer t' } }),
            }))
            expect(client.close).toHaveBeenCalledTimes(1)
            expect(warn).not.toHaveBeenCalled()
        })

        it('should warn about allowed tools the server does not expose', async () => {
            jest.mocked(createMCPClient).mockResolvedValue(mockClient())
            useModel(finalOutcome('unknown'))

            await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [{ ...grafana, allowedTools: ['query_logs', 'query_metrics', 'get_alerts'] }],
                logger,
            })

            expect(warn).toHaveBeenCalledWith('[ssandir/trypatch] MCP server "grafana" does not expose allowed tools "query_metrics", "get_alerts"')
        })

        it('should start stdio servers through the stdio transport', async () => {
            jest.mocked(createMCPClient).mockResolvedValue(mockClient())
            useModel(finalOutcome('unknown'))

            await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [{ name: 'db', type: 'stdio', command: 'npx', args: ['db-mcp'], env: { DB_URL: 'x' } }],
            })

            expect(Experimental_StdioMCPTransport).toHaveBeenCalledWith({ command: 'npx', args: ['db-mcp'], env: { DB_URL: 'x' } })
        })

        it('should resolve header functions once per investigation', async () => {
            jest.mocked(createMCPClient).mockImplementation(() => Promise.resolve(mockClient()))
            const headers = jest.fn(() => Promise.resolve({ Authorization: 'Bearer fresh' }))
            useModel(finalOutcome('a'), finalOutcome('b'))

            for (let i = 0; i < 2; i++) {
                await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                    timeoutMs: 5_000,
                    mcpServers: [{ ...grafana, headers }],
                })
            }

            expect(headers).toHaveBeenCalledTimes(2)
        })

        it('should skip an unreachable server with a warning, keeping other servers', async () => {
            const loki = mockClient({ loki_query: mcpTools()['query_logs']! })
            jest.mocked(createMCPClient)
                .mockRejectedValueOnce(new Error('connect ECONNREFUSED mcp.internal'))
                .mockResolvedValueOnce(loki)
            const model = useModel(finalOutcome('probably a timeout'))

            const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [grafana, { name: 'loki', type: 'http', url: 'https://loki.example.com/mcp' }],
                logger,
            })

            expect(result).toEqual({ type: 'result', result: { rootCause: 'probably a timeout' } })
            expect(warn).toHaveBeenCalledWith('[ssandir/trypatch] MCP server "grafana" is unavailable and was skipped', expect.any(Error))
            expect(model.doGenerateCalls[0]?.tools?.map(sentTool => sentTool.name)).toEqual(['loki__loki_query'])
            expect(loki.close).toHaveBeenCalledTimes(1)
        })

        it('should still investigate when every server is unavailable', async () => {
            jest.mocked(createMCPClient).mockRejectedValue(new Error('down'))
            const model = useModel(finalOutcome('rate limited'))

            const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [grafana],
                logger,
            })

            expect(result).toEqual({ type: 'result', result: { rootCause: 'rate limited' } })
            expect(model.doGenerateCalls[0]?.tools).toBeUndefined()
        })

        it('should restore redacted MCP tool input and redact its output', async () => {
            jest.mocked(createMCPClient).mockResolvedValue(mockClient())
            const vault = createVault({ terms: ['secret-order'] })
            const placeholder = String(vault.redact('secret-order'))
            queryLogs.mockReturnValueOnce({ lines: ['secret-order failed'] })
            const model = useModel(
                mockToolCallTurn('grafana__query_logs', { query: placeholder }),
                finalOutcome('stuck'),
            )

            await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [grafana],
                vault,
            })

            expect(queryLogs).toHaveBeenCalledWith({ query: 'secret-order' }, expect.anything())
            expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).not.toContain('secret-order')
        })

        it('should close clients when the investigation fails', async () => {
            const client = mockClient()
            jest.mocked(createMCPClient).mockResolvedValue(client)
            useModel(mockToolCallTurn('grafana__query_logs', { query: 'a' }), mockToolCallTurn('grafana__query_logs', { query: 'b' }, 'call-2'))

            await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [grafana],
                maxToolIterations: 1,
            })).rejects.toThrow('did not reach an outcome')
            expect(client.close).toHaveBeenCalledTimes(1)
        })

        it('should warn about a failing close without changing the outcome', async () => {
            const client = mockClient()
            client.close.mockRejectedValue(new Error('already closed'))
            jest.mocked(createMCPClient).mockResolvedValue(client)
            useModel(finalOutcome('rate limited'))

            const result = await investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                mcpServers: [grafana],
                logger,
            })

            expect(result).toEqual({ type: 'result', result: { rootCause: 'rate limited' } })
            expect(warn).toHaveBeenCalledWith('[ssandir/trypatch] Failed to close MCP client for server "grafana"', expect.any(Error))
        })

        it('should reject MCP tools that collide with an investigation tool', async () => {
            const client = mockClient({ lookup: mcpTools()['query_logs']! })
            jest.mocked(createMCPClient).mockResolvedValue(client)
            useModel(finalOutcome('x'))

            await expect(investigateWithLanguageModel(config, outcomeSchema, prompts, {
                timeoutMs: 5_000,
                investigationTools: [new Tool({ name: 'grafana__lookup', description: 'x', execute: () => null })],
                mcpServers: [grafana],
            })).rejects.toThrow('MCP tool "grafana__lookup" has the same name as an investigation tool')
            expect(client.close).toHaveBeenCalledTimes(1)
        })
    })
})
