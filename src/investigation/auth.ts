export type ApiKeyAuth
    = | { kind: 'inline', apiKey: string }
        | { kind: 'env', variable: string }
        | { kind: 'custom', resolve: () => string | Promise<string> }
