export const Providers = {
    OPENAI: 'openai',
    CURSOR: 'cursor',
    CLAUDE: 'claude',
} as const

export type Provider = typeof Providers[keyof typeof Providers]
