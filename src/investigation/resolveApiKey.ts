import type { ApiKeyAuth } from './auth'
import { Providers, type Provider } from './providers/types'
import { DEFAULT_AUTH_VARIABLE as CLAUDE_AUTH_VARIABLE } from './providers/claude/constants'
import { DEFAULT_AUTH_VARIABLE as CURSOR_AUTH_VARIABLE } from './providers/cursor/constants'
import { DEFAULT_AUTH_VARIABLE as OPENAI_AUTH_VARIABLE } from './providers/openai/constants'

export async function resolveApiKey (auth: ApiKeyAuth): Promise<string> {
    switch (auth.kind) {
        case 'inline':
            return auth.apiKey
        case 'env': {
            const value = process.env[auth.variable]
            if (!value) {
                throw new Error(`Missing environment variable: ${auth.variable}`)
            }
            return value
        }
        case 'custom':
            return auth.resolve()
        default: {
            const exhaustiveCheck: never = auth
            throw new Error(`Unsupported auth kind: ${String(exhaustiveCheck)}`)
        }
    }
}

export function defaultAuthVariable (provider: Provider): string {
    switch (provider) {
        case Providers.OPENAI:
            return OPENAI_AUTH_VARIABLE
        case Providers.CURSOR:
            return CURSOR_AUTH_VARIABLE
        case Providers.CLAUDE:
            return CLAUDE_AUTH_VARIABLE
        default: {
            const exhaustiveCheck: never = provider
            throw new Error(`Unsupported provider: ${String(exhaustiveCheck)}`)
        }
    }
}
