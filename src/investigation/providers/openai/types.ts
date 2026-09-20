import type { ApiKeyAuth } from '../../auth'
import { Providers } from '../types'

export type OpenAiInvestigationConfig = {
    provider: typeof Providers.OPENAI
    auth: ApiKeyAuth
    model?: string
    baseURL?: string
    organization?: string
    project?: string
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
