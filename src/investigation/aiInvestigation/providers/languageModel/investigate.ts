import { generateText, jsonSchema, Output, stepCountIs } from 'ai'
import type { Vault } from 'flare-redact'
import type { JSONSchema } from 'json-schema-to-ts'
import { parseProviderOutcome, type InvestigationOutcome } from '../../resultSchema'
import type { LooseTool } from '../../toolAdapter'
import { DEFAULT_MAX_TOOL_ITERATIONS } from './constants'
import { createLanguageModel } from './createLanguageModel'
import { toolsToAiSdkTools } from './toolAdapter'
import type { LanguageModelInvestigationConfig } from './types'

export type LanguageModelInvestigationOptions = {
    timeoutMs: number
    maxTokens?: number | undefined
    maxToolIterations?: number | undefined
    investigationTools?: LooseTool[] | undefined
    toolContext?: unknown
    vault?: Vault | undefined
}

export async function investigateWithLanguageModel (
    config: LanguageModelInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: LanguageModelInvestigationOptions,
): Promise<InvestigationOutcome> {
    const tools = toolsToAiSdkTools(options.investigationTools, options.toolContext, options.vault)
    const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS

    const result = await generateText({
        model: createLanguageModel(config),
        system: prompts.systemPrompt,
        prompt: prompts.userPrompt,
        ...tools ? { tools } : {},
        output: Output.object({ schema: jsonSchema(outcomeSchema as Parameters<typeof jsonSchema>[0]) }),
        // Producing the structured output is a step of its own on top of the tool rounds.
        stopWhen: stepCountIs(maxToolIterations + 1),
        abortSignal: AbortSignal.timeout(options.timeoutMs),
        ...options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {},
        providerOptions: {
            openai: { strictJsonSchema: true },
        },
    })

    if (result.finishReason === 'tool-calls') {
        throw new Error(`Investigation did not reach an outcome within ${maxToolIterations} tool iterations`)
    }

    return parseProviderOutcome(JSON.stringify(result.output), outcomeSchema)
}
