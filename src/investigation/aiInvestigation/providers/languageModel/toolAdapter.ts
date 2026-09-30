import { jsonSchema, tool, type ToolSet } from 'ai'
import type { Vault } from 'flare-redact'
import { restoreInvestigationResponse } from '../../redact/flareRedact'
import type { LooseTool } from '../../toolAdapter'

// Tools can hang past the investigation deadline; AI SDK only hands them the signal, it doesn't enforce it.
function rejectOnAbort (abortSignal: AbortSignal | undefined): Promise<never> {
    return new Promise((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => {
            reject(abortSignal.reason instanceof Error ? abortSignal.reason : new Error('Investigation aborted'))
        }, { once: true })
    })
}

export function toolsToAiSdkTools (
    tools: LooseTool[] | undefined,
    toolContext: unknown,
    vault: Vault | undefined,
): ToolSet | undefined {
    if (tools === undefined || tools.length === 0) {
        return undefined
    }

    return Object.fromEntries(tools.map(investigationTool => [
        investigationTool.name,
        tool({
            description: investigationTool.description,
            // Tool.call already parses and validates its own input.
            inputSchema: jsonSchema(investigationTool.parameters as Parameters<typeof jsonSchema>[0]),
            execute: async (input: unknown, { abortSignal }) => {
                abortSignal?.throwIfAborted()
                // The model only ever sees redacted placeholders, so tools need the real values back,
                // and their output must be redacted before it reaches the provider.
                const output = await Promise.race([
                    investigationTool.call(JSON.stringify(restoreInvestigationResponse(input, vault)), toolContext),
                    rejectOnAbort(abortSignal),
                ])
                return vault ? vault.redact(output) : output
            },
        }),
    ]))
}
