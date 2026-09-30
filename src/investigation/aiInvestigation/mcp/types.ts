/** Static headers, or a function resolved once per investigation (short-lived tokens, secret managers, ...). */
export type McpHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)

export type McpRemoteServerConfig = {
    /** Unique per investigation; letters, digits, `_` and `-`. Tools are exposed to the AI as `<name>__<tool>`. */
    name: string
    type: 'http' | 'sse'
    url: string
    headers?: McpHeaders
    /** Tools the AI may call. Omitted means every tool the server exposes. Not supported by `cursor`. */
    allowedTools?: string[]
    /** Custom `fetch` implementation for requests to this server. Ignored by `cursor`. */
    fetch?: typeof fetch
}

export type McpStdioServerConfig = {
    /** Unique per investigation; letters, digits, `_` and `-`. Tools are exposed to the AI as `<name>__<tool>`. */
    name: string
    type: 'stdio'
    command: string
    args?: string[]
    env?: Record<string, string>
    /** Ignored by `cursor`, which runs the command inside its cloud VM. */
    cwd?: string
    /** Tools the AI may call. Omitted means every tool the server exposes. Not supported by `cursor`. */
    allowedTools?: string[]
}

export type McpServerConfig = McpRemoteServerConfig | McpStdioServerConfig

export type UnavailableMcpServer = {
    name: string
    reason: string
}
