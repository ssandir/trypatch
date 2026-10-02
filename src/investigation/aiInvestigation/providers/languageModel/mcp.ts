import { createMCPClient, type MCPClient, type MCPClientConfig } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { ToolSet } from 'ai'
import type { Logger } from '../../../../logger'
import { resolveMcpServers, warnUnavailableMcpServer } from '../../mcp/servers'
import type { McpServerConfig, ResolvedMcpServerConfig } from '../../mcp/types'
import type { McpConnection } from './types'

function buildTransport (server: ResolvedMcpServerConfig): MCPClientConfig['transport'] {
    if (server.type === 'stdio') {
        return new Experimental_StdioMCPTransport({
            command: server.command,
            ...server.args ? { args: server.args } : {},
            ...server.env ? { env: server.env } : {},
            ...server.cwd ? { cwd: server.cwd } : {},
        })
    }

    return {
        type: server.type,
        url: server.url,
        redirect: 'error',
        ...server.headers ? { headers: server.headers } : {},
        ...server.fetch ? { fetch: server.fetch } : {},
    }
}

async function connectMcpServer (
    server: ResolvedMcpServerConfig,
    abortSignal: AbortSignal,
    logger: Logger,
): Promise<{ client: MCPClient, tools: ToolSet }> {
    const client = await createMCPClient({
        transport: buildTransport(server),
        clientName: '@ssandir/trypatch',
        initializationOptions: { signal: abortSignal },
    })

    try {
        return { client, tools: await client.tools() }
    } catch (error) {
        await closeClients([{ name: server.name, client }], logger)
        throw error
    }
}

function exposeServerTools (server: McpServerConfig, tools: ToolSet, logger: Logger): ToolSet {
    const { allowedTools } = server
    const missing = allowedTools?.filter(name => !(name in tools)) ?? []
    if (missing.length > 0) {
        logger.warn(`[ssandir/trypatch] MCP server "${server.name}" does not expose allowed tools ${missing.map(name => `"${name}"`).join(', ')}`)
    }

    // Prefixing keeps two servers exposing the same tool name from colliding.
    return Object.fromEntries(Object.entries(tools)
        .filter(([name]) => allowedTools === undefined || allowedTools.includes(name))
        .map(([name, tool]) => [`${server.name}__${name}`, tool]))
}

type ConnectedMcpClient = { name: string, client: MCPClient }

async function closeClients (clients: ConnectedMcpClient[], logger: Logger): Promise<void> {
    const results = await Promise.allSettled(clients.map(({ client }) => client.close()))
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            logger.warn(`[ssandir/trypatch] Failed to close MCP client for server "${clients[index]!.name}"`, result.reason)
        }
    })
}

/**
 * Servers that can't be reached are logged and skipped rather than thrown: the investigation
 * may still reach an outcome without them, and the escape outcomes cover the case where it can't.
 */
export async function connectMcpTools (
    servers: McpServerConfig[],
    abortSignal: AbortSignal,
    logger: Logger,
): Promise<McpConnection> {
    const resolved = await resolveMcpServers(servers, logger)
    const settled = await Promise.allSettled(resolved.map(server => connectMcpServer(server, abortSignal, logger)))

    const clients: ConnectedMcpClient[] = []
    const tools: ToolSet = {}

    settled.forEach((result, index) => {
        const server = resolved[index]!
        if (result.status === 'fulfilled') {
            clients.push({ name: server.name, client: result.value.client })
            Object.assign(tools, exposeServerTools(server, result.value.tools, logger))
        } else {
            warnUnavailableMcpServer(server.name, result.reason, logger)
        }
    })

    return { tools, close: () => closeClients(clients, logger) }
}
