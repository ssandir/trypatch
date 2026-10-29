import type { InvestigationProviderConfig } from '@ssandir/trypatch'
import { getProxyToken } from './shared'

export const openai = {
    // #region openai
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    // #endregion openai
} satisfies InvestigationProviderConfig

export const claude = {
    // #region claude
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    // #endregion claude
} satisfies InvestigationProviderConfig

export const openaiCompatible = {
    // #region openai-compatible
    provider: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3.8-flash',
    apiKey: process.env.OPENROUTER_API_KEY!,
    supportsStructuredOutputs: true,
    // #endregion openai-compatible
} satisfies InvestigationProviderConfig

export const cursor = {
    // #region cursor
    provider: 'cursor',
    apiKey: process.env.CURSOR_API_KEY!,
    repository: { url: 'https://github.com/acme/payments' },
    // #endregion cursor
} satisfies InvestigationProviderConfig

export const proxied = {
    // #region custom-fetch
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    fetch: async (url, init) => {
        const headers = new Headers(init?.headers)
        headers.set('X-Proxy-Token', await getProxyToken())
        return await fetch(url, { ...init, headers })
    },
    // #endregion custom-fetch
} satisfies InvestigationProviderConfig
