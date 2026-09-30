import type { Vault } from 'flare-redact'
import { TrypatchConfigError } from '../../../errors'
import type { Logger } from '../../../logger'
import type { InvestigationProviderConfig } from '../../../types'
import type { McpServerConfig, UnavailableMcpServer } from './types'

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
): Promise<{ servers: ResolvedMcpServerConfig[], unavailable: UnavailableMcpServer[] }> {
    const settled = await Promise.allSettled(servers.map(async (server): Promise<ResolvedMcpServerConfig> => {
        if (server.type === 'stdio' || typeof server.headers !== 'function') {
            return server as ResolvedMcpServerConfig
        }

        return { ...server, headers: await server.headers() }
    }))

    const resolved: ResolvedMcpServerConfig[] = []
    const unavailable: UnavailableMcpServer[] = []

    settled.forEach((result, index) => {
        const server = servers[index]!
        if (result.status === 'fulfilled') {
            resolved.push(result.value)
        } else {
            unavailable.push(reportUnavailableMcpServer(server.name, result.reason, logger))
        }
    })

    return { servers: resolved, unavailable }
}

export function reportUnavailableMcpServer (name: string, error: unknown, logger: Logger): UnavailableMcpServer {
    logger.warn(`[ssandir/trypatch] MCP server "${name}" unavailable:`, error)
    return { name, reason: error instanceof Error ? error.message : String(error) }
}

/**
 * Tells the model which servers it can't use, so it can fall back to an escape outcome
 * instead of guessing. Connection errors can contain hosts and URLs, hence the redaction.
 */
export function appendUnavailableMcpServersNote (
    userPrompt: string,
    unavailable: UnavailableMcpServer[],
    vault: Vault | undefined,
): string {
    if (unavailable.length === 0) {
        return userPrompt
    }

    const note = [
        'Note: these MCP servers were unavailable for this investigation, so their tools cannot be called:',
        ...unavailable.map(({ name, reason }) => `- ${name}: ${reason}`),
    ].join('\n')

    return `${userPrompt}\n\n${vault ? String(vault.redact(note)) : note}`
}
