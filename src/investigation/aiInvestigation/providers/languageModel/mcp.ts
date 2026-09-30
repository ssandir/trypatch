import { createMCPClient, type MCPClient, type MCPClientConfig } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import type { ToolSet } from 'ai'
import type { Logger } from '../../../../logger'
import { reportUnavailableMcpServer, resolveMcpServers, type ResolvedMcpServerConfig } from '../../mcp/servers'
import type { McpServerConfig, UnavailableMcpServer } from '../../mcp/types'

export type McpConnection = {
    tools: ToolSet
    unavailable: UnavailableMcpServer[]
    close: () => Promise<void>
}

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
        clientName: 'ssandir/trypatch',
        initializationOptions: { signal: abortSignal },
    })

    try {
        return { client, tools: await client.tools() }
    } catch (error) {
        await closeClients([client], logger)
        throw error
    }
}

function exposeServerTools (server: McpServerConfig, tools: ToolSet, logger: Logger): ToolSet {
    const { allowedTools } = server
    const missing = allowedTools?.filter(name => !(name in tools)) ?? []
    if (missing.length > 0) {
        logger.warn(`[ssandir/trypatch] MCP server "${server.name}" does not expose allowed tools:`, missing)
    }

    // Prefixing keeps two servers exposing the same tool name from colliding.
    return Object.fromEntries(Object.entries(tools)
        .filter(([name]) => allowedTools === undefined || allowedTools.includes(name))
        .map(([name, tool]) => [`${server.name}__${name}`, tool]))
}

async function closeClients (clients: MCPClient[], logger: Logger): Promise<void> {
    const results = await Promise.allSettled(clients.map(client => client.close()))
    for (const result of results) {
        if (result.status === 'rejected') {
            logger.warn('[ssandir/trypatch] Failed to close MCP client:', result.reason)
        }
    }
}

/**
 * Servers that can't be reached are reported in `unavailable` rather than thrown:
 * the investigation may still reach an outcome without them.
 */
export async function connectMcpTools (
    servers: McpServerConfig[],
    abortSignal: AbortSignal,
    logger: Logger,
): Promise<McpConnection> {
    const resolved = await resolveMcpServers(servers, logger)
    const settled = await Promise.allSettled(resolved.servers.map(server => connectMcpServer(server, abortSignal, logger)))

    const clients: MCPClient[] = []
    const tools: ToolSet = {}
    const unavailable = [...resolved.unavailable]

    settled.forEach((result, index) => {
        const server = resolved.servers[index]!
        if (result.status === 'fulfilled') {
            clients.push(result.value.client)
            Object.assign(tools, exposeServerTools(server, result.value.tools, logger))
        } else {
            unavailable.push(reportUnavailableMcpServer(server.name, result.reason, logger))
        }
    })

    return { tools, unavailable, close: () => closeClients(clients, logger) }
}
