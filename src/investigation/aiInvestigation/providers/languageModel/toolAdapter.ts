import {
    jsonSchema,
    tool,
    type Tool,
    type ToolExecutionOptions,
    type ToolSet,
} from 'ai'
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

type ToolExecute = (input: unknown, options: ToolExecutionOptions<unknown>) => unknown

function guardToolExecution (execute: ToolExecute, vault: Vault | undefined): (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown> {
    return async (input, options) => {
        options.abortSignal?.throwIfAborted()
        // The model only ever sees redacted placeholders, so tools need the real values back,
        // and their output must be redacted before it reaches the provider.
        const output = await Promise.race([
            Promise.resolve(execute(restoreInvestigationResponse(input, vault), options)),
            rejectOnAbort(options.abortSignal),
        ])
        return vault ? vault.redact(output) : output
    }
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
            execute: guardToolExecution(input => investigationTool.call(JSON.stringify(input), toolContext), vault),
        }),
    ]))
}

export function guardMcpTools (tools: ToolSet, vault: Vault | undefined): ToolSet {
    return Object.fromEntries(Object.entries(tools).map(([name, mcpTool]) => {
        const execute = mcpTool.execute as ToolExecute | undefined
        return [name, execute ? { ...mcpTool, execute: guardToolExecution(execute, vault) } as Tool : mcpTool]
    }))
}
