import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'

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
