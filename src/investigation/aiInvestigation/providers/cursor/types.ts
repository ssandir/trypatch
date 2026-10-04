import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'

export type CursorRepositoryConfig = {
    url: string
    startingRef?: string
    prUrl?: string
}

export type CursorInvestigationConfig = {
    provider: 'cursor'
    apiKey: string
    baseURL?: string
    model?: string | { id: string, params?: { id: string, value: string | boolean | number }[] }
    repository?: CursorRepositoryConfig
    pollIntervalMs?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

export type CursorCreateAgentResponse = {
    agent?: {
        id?: string
    }
    run?: {
        id?: string
    }
    error?: {
        message?: string
    }
}

export type CursorRunResponse = {
    id?: string
    status?: string
    result?: string
    error?: {
        message?: string
    }
}

export type CursorInvestigationOptions = {
    mcpServers?: McpServerConfig[] | undefined
    logger?: Logger | undefined
    signal?: AbortSignal | undefined
}
