import { TrypatchConfigError } from '../../../errors'
import type { Logger } from '../../../logger'
import type { InvestigationProviderConfig } from '../../../types'
import type { McpServerConfig } from './types'

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

export function validateMcpServers (
    servers: McpServerConfig[] | undefined,
    provider: InvestigationProviderConfig['provider'],
): void {
    const seen = new Set<string>()

    for (const server of servers ?? []) {
        if (!SERVER_NAME_PATTERN.test(server.name)) {
            throw new TrypatchConfigError(`MCP server name "${server.name}" may only contain letters, digits, "_" and "-"`)
        }

        if (seen.has(server.name)) {
            throw new TrypatchConfigError(`MCP server name "${server.name}" is used more than once`)
        }
        seen.add(server.name)

        if (server.type !== 'stdio') {
            validateServerUrl(server.name, server.url)
        }

        // Dropping an allowlist the user asked for would silently widen what the AI can call.
        if (provider === 'cursor' && server.allowedTools !== undefined) {
            throw new TrypatchConfigError(`MCP server "${server.name}": allowedTools is not supported by the cursor provider`)
        }
    }
}

function validateServerUrl (name: string, url: string): void {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        throw new TrypatchConfigError(`MCP server "${name}" has an invalid url`)
    }

    if (parsed.username || parsed.password) {
        throw new TrypatchConfigError(`MCP server "${name}": pass credentials through headers, not the url`)
    }
}

export type ResolvedMcpServerConfig = McpServerConfig & { headers?: Record<string, string> }

/**
 * Header functions run once per investigation. A failing one makes that server unavailable
 * rather than failing the investigation, same as a server that refuses to connect.
 */
export async function resolveMcpServers (
    servers: McpServerConfig[],
    logger: Logger,
): Promise<ResolvedMcpServerConfig[]> {
    const settled = await Promise.allSettled(servers.map(async (server): Promise<ResolvedMcpServerConfig> => {
        if (server.type === 'stdio' || typeof server.headers !== 'function') {
            return server as ResolvedMcpServerConfig
        }

        return { ...server, headers: await server.headers() }
    }))

    const resolved: ResolvedMcpServerConfig[] = []

    settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            resolved.push(result.value)
        } else {
            warnUnavailableMcpServer(servers[index]!.name, result.reason, logger)
        }
    })

    return resolved
}

export function warnUnavailableMcpServer (name: string, error: unknown, logger: Logger): void {
    logger.warn(`[ssandir/trypatch] MCP server "${name}" is unavailable and was skipped`, error)
}
