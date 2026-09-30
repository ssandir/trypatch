export type ClaudeInvestigationConfig = {
    provider: 'claude'
    apiKey: string
    model?: string
    baseURL?: string
    apiVersion?: string
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}
