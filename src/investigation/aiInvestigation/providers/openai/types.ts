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

export type OpenAiToolCall = {
    id?: string
    type?: 'function'
    function?: {
        name?: string
        arguments?: string
    }
}

export type OpenAiChatCompletionResponse = {
    choices?: {
        message?: {
            content?: string | null
            tool_calls?: OpenAiToolCall[]
        }
    }[]
    error?: {
        message?: string
    }
}
