/**
 * Provider config, picked by its `provider` field.
 * @group Providers
 */
export type InvestigationProviderConfig
    = | LanguageModelInvestigationConfig
        | CursorInvestigationConfig

/**
 * Anthropic's Messages API with JSON Schema output.
 * @group Providers
 */
export type ClaudeInvestigationConfig = {
    provider: 'claude'
    /** Resolve it yourself (env var, secret manager, ...). */
    apiKey: string
    /** @defaultValue `'claude-sonnet-5'` */
    model?: string
    /**
     * Without the `/v1` suffix.
     * @defaultValue `'https://api.anthropic.com'`
     */
    baseURL?: string
    /**
     * Sent as the `anthropic-version` header.
     * @defaultValue `'2023-06-01'`
     */
    apiVersion?: string
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

/**
 * OpenAI's Responses API with strict JSON Schema output.
 * @group Providers
 */
export type OpenAiInvestigationConfig = {
    provider: 'openai'
    /** Resolve it yourself (env var, secret manager, ...). */
    apiKey: string
    /** @defaultValue `'gpt-5.5'` */
    model?: string
    /** @defaultValue `'https://api.openai.com/v1'` */
    baseURL?: string
    /** Sent as the `OpenAI-Organization` header. */
    organization?: string
    /** Sent as the `OpenAI-Project` header. */
    project?: string
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

/**
 * Any provider exposing an OpenAI-compatible Chat Completions API (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...).
 * @group Providers
 */
export type OpenAiCompatibleInvestigationConfig = {
    provider: 'openai-compatible'
    /** The endpoint's API root, e.g. `'https://openrouter.ai/api/v1'` for OpenRouter. */
    baseURL: string
    /** Model id as the endpoint names it. */
    model: string
    /** Sent as a bearer token; omit it for endpoints without auth. */
    apiKey?: string
    /** Extra headers sent with every request. */
    headers?: Record<string, string>
    /**
     * Whether the endpoint enforces JSON Schema structured output. When `false`, the model is only
     * asked for JSON and the outcome is validated after the fact.
     * @defaultValue `false`
     */
    supportsStructuredOutputs?: boolean
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
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
 * Providers that run investigation tools and MCP connections locally, in your process.
 * @group Providers
 */
export type LanguageModelInvestigationConfig
    = | ClaudeInvestigationConfig
        | OpenAiInvestigationConfig
        | OpenAiCompatibleInvestigationConfig
