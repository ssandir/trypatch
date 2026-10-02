import { generateText, jsonSchema, Output, stepCountIs, type ToolSet } from 'ai'
import type { Vault } from 'flare-redact'
import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchConfigError } from '../../../../errors'
import { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'
import { parseProviderOutcome, type InvestigationOutcome } from '../../resultSchema'
import type { LooseTool } from '../../toolAdapter'
import { DEFAULT_MAX_TOOL_ITERATIONS, MAX_TOOL_NAME_LENGTH } from './constants'
import { createLanguageModel } from './createLanguageModel'
import { connectMcpTools } from './mcp'
import { guardMcpTools, toolsToAiSdkTools } from './toolAdapter'
import type { LanguageModelInvestigationConfig } from './types'

export type LanguageModelInvestigationOptions = {
    timeoutMs: number
    maxTokens?: number | undefined
    maxToolIterations?: number | undefined
    investigationTools?: LooseTool[] | undefined
    toolContext?: unknown
    vault?: Vault | undefined
    mcpServers?: McpServerConfig[] | undefined
    logger?: Logger | undefined
}

function mergeTools (investigationTools: ToolSet | undefined, mcpTools: ToolSet): ToolSet | undefined {
    for (const name of Object.keys(mcpTools)) {
        if (investigationTools && name in investigationTools) {
            throw new TrypatchConfigError(`MCP tool "${name}" has the same name as an investigation tool`)
        }

        if (name.length > MAX_TOOL_NAME_LENGTH) {
            throw new TrypatchConfigError(`MCP tool "${name}" exceeds ${MAX_TOOL_NAME_LENGTH} characters; use a shorter server name`)
        }
    }

    const tools = { ...investigationTools, ...mcpTools }
    return Object.keys(tools).length > 0 ? tools : undefined
}

export async function investigateWithLanguageModel (
    config: LanguageModelInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: LanguageModelInvestigationOptions,
): Promise<InvestigationOutcome> {
    const maxToolIterations = options.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
    // Shared by MCP connection setup and the tool loop, so timeoutMs covers both.
    const abortSignal = AbortSignal.timeout(options.timeoutMs)
    const mcp = await connectMcpTools(options.mcpServers ?? [], abortSignal, options.logger ?? new Logger())

    try {
        const tools = mergeTools(
            toolsToAiSdkTools(options.investigationTools, options.toolContext, options.vault),
            guardMcpTools(mcp.tools, options.vault),
        )

        const result = await generateText({
            model: createLanguageModel(config),
            system: prompts.systemPrompt,
            prompt: prompts.userPrompt,
            ...tools ? { tools } : {},
            output: Output.object({ schema: jsonSchema(outcomeSchema as Parameters<typeof jsonSchema>[0]) }),
            // Producing the structured output is a step of its own on top of the tool rounds.
            stopWhen: stepCountIs(maxToolIterations + 1),
            abortSignal,
            ...options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {},
            providerOptions: {
                openai: { strictJsonSchema: true },
            },
        })

        if (result.finishReason === 'tool-calls') {
            throw new Error(`Investigation did not reach an outcome within ${maxToolIterations} tool iterations`)
        }

        return parseProviderOutcome(JSON.stringify(result.output), outcomeSchema)
    } finally {
        await mcp.close()
    }
}
