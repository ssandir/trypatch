import { generateText, isLoopFinished, jsonSchema, Output, stepCountIs, type JSONSchema7, type ToolSet } from 'ai'
import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchConfigError } from '../../../../errors'
import { Logger } from '../../../../logger'
import { outcomeSchemaPrompt, parseProviderOutcome, type InvestigationOutcome } from '../../resultSchema'
import { MAX_TOOL_NAME_LENGTH } from './constants'
import { createLanguageModel } from './createLanguageModel'
import { connectMcpTools } from './mcp'
import { guardMcpTools, toolsToAiSdkTools } from './toolAdapter'
import type { LanguageModelInvestigationConfig, LanguageModelInvestigationOptions } from './types'

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

// Without `supportsStructuredOutputs`, the OpenAI-compatible provider drops the schema and only asks for JSON.
function enforcesOutputSchema (config: LanguageModelInvestigationConfig): boolean {
    return config.provider !== 'openai-compatible' || config.supportsStructuredOutputs === true
}

export async function investigateWithLanguageModel<C> (
    config: LanguageModelInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: LanguageModelInvestigationOptions<C>,
): Promise<InvestigationOutcome> {
    const { maxToolIterations } = config

    const mcp = await connectMcpTools(options.mcpServers ?? [], options.signal, options.logger ?? new Logger())

    try {
        const tools = mergeTools(
            toolsToAiSdkTools(options.investigationTools, options.toolContext, options.vault),
            guardMcpTools(mcp.tools, options.vault),
        )

        const result = await generateText({
            model: createLanguageModel(config),
            system: prompts.systemPrompt,
            prompt: enforcesOutputSchema(config) ? prompts.userPrompt : `${prompts.userPrompt}\n\n${outcomeSchemaPrompt(outcomeSchema)}`,
            ...tools ? { tools } : {},
            // json-schema-to-ts also allows boolean schemas and readonly arrays; ours is always a plain object.
            output: Output.object({ schema: jsonSchema(outcomeSchema as JSONSchema7) }),
            // Producing the structured output is a step of its own on top of the tool rounds. Without a cap the
            // loop still ends once the model returns its outcome; generateText's own default would allow no tool rounds.
            stopWhen: maxToolIterations === undefined ? isLoopFinished() : stepCountIs(maxToolIterations + 1),
            ...options.signal ? { abortSignal: options.signal } : {},
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
