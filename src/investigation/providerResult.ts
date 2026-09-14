export type InvestigationProviderResult
    = | { kind: 'result', result: unknown }
        | { kind: 'result-tool', toolName: string, input: string }
