import type { ApiKeyAuth } from '../../auth'
import { Providers } from '../types'

export type ClaudeInvestigationConfig = {
    provider: typeof Providers.CLAUDE
    auth: ApiKeyAuth
    model?: string
    baseURL?: string
    apiVersion?: string
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
