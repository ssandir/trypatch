import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { DEFAULT_CLAUDE_BASE_URL, DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL } from './constants'
import type { LanguageModelInvestigationConfig } from './types'

// Maps our own provider configs onto AI SDK models so no AI SDK type leaks into the public API —
// AI SDK major upgrades stay an internal change. baseURL is always passed: without one, the AI SDK
// reads ANTHROPIC_BASE_URL / OPENAI_BASE_URL, which would let the environment redirect our calls.
export function createLanguageModel (config: LanguageModelInvestigationConfig): LanguageModel {
    switch (config.provider) {
        case 'claude':
            return createAnthropic({
                apiKey: config.apiKey,
                baseURL: `${(config.baseURL ?? DEFAULT_CLAUDE_BASE_URL).replace(/\/$/, '')}/v1`,
                ...config.apiVersion ? { headers: { 'anthropic-version': config.apiVersion } } : {},
                ...config.fetch ? { fetch: config.fetch } : {},
            })(config.model ?? DEFAULT_CLAUDE_MODEL)
        case 'openai':
            return createOpenAI({
                apiKey: config.apiKey,
                baseURL: config.baseURL ?? DEFAULT_OPENAI_BASE_URL,
                ...config.organization ? { organization: config.organization } : {},
                ...config.project ? { project: config.project } : {},
                ...config.fetch ? { fetch: config.fetch } : {},
            })(config.model ?? DEFAULT_OPENAI_MODEL)
        case 'openai-compatible':
            return createOpenAICompatible({
                name: 'openai-compatible',
                baseURL: config.baseURL,
                ...config.apiKey ? { apiKey: config.apiKey } : {},
                ...config.headers ? { headers: config.headers } : {},
                ...config.supportsStructuredOutputs !== undefined
                    ? { supportsStructuredOutputs: config.supportsStructuredOutputs }
                    : {},
                ...config.fetch ? { fetch: config.fetch } : {},
            })(config.model)
    }
}
