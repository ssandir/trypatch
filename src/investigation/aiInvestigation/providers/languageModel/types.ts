import type { ToolSet } from 'ai'
import type { Vault } from 'flare-redact'
import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'
import type { InvestigationTool } from '../../../../types'

export type ClaudeInvestigationConfig = {
    provider: 'claude'
    apiKey: string
    model?: string
    baseURL?: string
    apiVersion?: string
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

export type OpenAiInvestigationConfig = {
    provider: 'openai'
    apiKey: string
    model?: string
    baseURL?: string
    organization?: string
    project?: string
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

/** Any provider exposing an OpenAI-compatible Chat Completions API (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...). */
export type OpenAiCompatibleInvestigationConfig = {
    provider: 'openai-compatible'
    baseURL: string
    model: string
    apiKey?: string
    /** Extra headers sent with every request. */
    headers?: Record<string, string>
    /**
     * Whether the endpoint enforces JSON Schema structured output. When `false` (the default), the model
     * is only asked for JSON and the outcome is validated after the fact.
     */
    supportsStructuredOutputs?: boolean
    /** Maximum model turns spent calling investigation and MCP tools before returning an outcome. Unlimited by default. */
    maxToolIterations?: number
    /** Maximum tokens the model may generate per turn. */
    maxTokens?: number
    /** Custom `fetch` implementation, used instead of the global one (proxying, custom auth, logging, retries, ...). */
    fetch?: typeof fetch
}

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
