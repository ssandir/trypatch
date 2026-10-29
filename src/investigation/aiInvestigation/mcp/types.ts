/**
 * Static headers, or a function resolved once per investigation (short-lived tokens, secret managers, ...).
 * @group MCP
 */
export type McpHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)

/**
 * An MCP server reached over HTTP (Streamable HTTP or SSE).
 * @group MCP
 */
export type McpRemoteServerConfig<THeaders = McpHeaders> = {
    /** Unique per investigation; letters, digits, `_` and `-`. Tools are exposed to the AI as `<name>__<tool>`. */
    name: string
    /** `'http'` for Streamable HTTP, `'sse'` for the older SSE transport. */
    type: 'http' | 'sse'
    /** Must not contain credentials; pass them in `headers`. */
    url: string
    /** Sent with every request, e.g. `Authorization`; a function is called once per investigation. */
    headers?: THeaders
    /** Tools the AI may call. Omitted means every tool the server exposes. Not supported by `cursor`. */
    allowedTools?: string[]
    /** Custom `fetch` implementation for requests to this server. Ignored by `cursor`. */
    fetch?: typeof fetch
}

/**
 * An MCP server started as a local process, once per investigation.
 * @group MCP
 */
export type McpStdioServerConfig = {
    /** Unique per investigation; letters, digits, `_` and `-`. Tools are exposed to the AI as `<name>__<tool>`. */
    name: string
    type: 'stdio'
    /** Executable to start, e.g. `'npx'`. */
    command: string
    /** Arguments for `command`, e.g. `['some-db-mcp']`. */
    args?: string[]
    /** Environment for the process, the place for its secrets; with `cursor`, sent to Cursor. */
    env?: Record<string, string>
    /** Ignored by `cursor`, which runs the command inside its cloud VM. */
    cwd?: string
    /** Tools the AI may call. Omitted means every tool the server exposes. Not supported by `cursor`. */
    allowedTools?: string[]
}

/**
 * An MCP server whose tools the AI may call while investigating.
 * @group MCP
 */
export type McpServerConfig<THeaders = McpHeaders> = McpRemoteServerConfig<THeaders> | McpStdioServerConfig

/** A server whose `headers` function, if it had one, has been called for this investigation. */
export type ResolvedMcpServerConfig = McpServerConfig<Record<string, string>>
