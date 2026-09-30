export type OpenAiInvestigationConfig = {
    provider: 'openai'
    apiKey: string
    model?: string
    baseURL?: string
    organization?: string
    project?: string
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}
