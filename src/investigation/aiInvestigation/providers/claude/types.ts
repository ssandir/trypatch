export type ClaudeInvestigationConfig = {
    provider: 'claude'
    apiKey: string
    model?: string
    baseURL?: string
    apiVersion?: string
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

export type ClaudeContentBlock
    = | { type: 'text', text?: string }
        | { type: 'tool_use', name?: string, input?: unknown }
        | { type: string, [key: string]: unknown }

export type ClaudeMessagesResponse = {
    content?: ClaudeContentBlock[]
    error?: {
        message?: string
    }
}
