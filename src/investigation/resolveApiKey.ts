import type { ApiKeyAuth } from '../trypatchOptions'

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

export function defaultAuthVariable (provider: 'openai' | 'cursor'): string {
    return provider === 'openai' ? 'OPENAI_API_KEY' : 'CURSOR_API_KEY'
}
