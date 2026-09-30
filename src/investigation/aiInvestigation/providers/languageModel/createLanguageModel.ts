import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_MODEL } from './constants'
import type { LanguageModelInvestigationConfig } from './types'

// Maps our own provider configs onto AI SDK models so no AI SDK type leaks into the public API —
// AI SDK major upgrades stay an internal change.
export function createLanguageModel (config: LanguageModelInvestigationConfig): LanguageModel {
    switch (config.provider) {
        case 'claude':
            return createAnthropic({
                apiKey: config.apiKey,
                ...config.baseURL ? { baseURL: `${config.baseURL.replace(/\/$/, '')}/v1` } : {},
                ...config.apiVersion ? { headers: { 'anthropic-version': config.apiVersion } } : {},
                ...config.fetch ? { fetch: config.fetch } : {},
            })(config.model ?? DEFAULT_CLAUDE_MODEL)
        case 'openai':
            return createOpenAI({
                apiKey: config.apiKey,
                ...config.baseURL ? { baseURL: config.baseURL } : {},
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
