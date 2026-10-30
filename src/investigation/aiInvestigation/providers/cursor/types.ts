import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'

/**
 * Repository the Cursor agent checks out, so it can read your code while investigating.
 * @group Providers
 * @inline
 * @hidden
 */
export type CursorRepositoryConfig = {
    /** Repository URL, e.g. `'https://github.com/acme/payments'`. */
    url: string
    /** Branch, tag or commit to check out instead of the default branch. */
    startingRef?: string
    /** Pull request to work from. */
    prUrl?: string
}

/**
 * Cursor Cloud Agents: starts a cloud agent and polls its run until it finishes. Supports `mcpServers` but not `investigationTools`.
 * @group Providers
 */
export type CursorInvestigationConfig = {
    provider: 'cursor'
    /** Sent with Basic auth, or as is if it starts with `Bearer `. */
    apiKey: string
    /** @defaultValue `'https://api.cursor.com'` */
    baseURL?: string
    /** Model id, or an id with model parameters; Cursor's default model when omitted. */
    model?: string | {
        /** Model id. */
        id: string
        /** Passed to Cursor's Create Agent request as `model.params`. */
        params?: {
            /** Parameter id, as Cursor names it. */
            id: string
            /** Parameter value. */
            value: string | boolean | number
        }[]
    }
    /** Repository the agent checks out; without one, it only sees the prompt and its MCP servers. */
    repository?: CursorRepositoryConfig
    /**
     * How often the run's status is checked.
     * @defaultValue `2000`
     */
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
