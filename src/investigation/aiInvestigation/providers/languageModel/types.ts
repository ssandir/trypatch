import type { ToolSet } from 'ai'
import type { Vault } from 'flare-redact'
import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'
import type { InvestigationTool } from '../../../../types'

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
 * Providers that run investigation tools and MCP connections locally, in your process.
 * @group Providers
 */
export type LanguageModelInvestigationConfig
    = | ClaudeInvestigationConfig
        | OpenAiInvestigationConfig
        | OpenAiCompatibleInvestigationConfig

export type LanguageModelInvestigationOptions<C = unknown> = {
    investigationTools?: InvestigationTool<C>[] | undefined
    toolContext?: C | undefined
    vault?: Vault | undefined
    mcpServers?: McpServerConfig[] | undefined
    logger?: Logger | undefined
    signal?: AbortSignal | undefined
}

export type McpConnection = {
    tools: ToolSet
    close: () => Promise<void>
}
