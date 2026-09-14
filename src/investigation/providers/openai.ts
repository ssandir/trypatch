import { getSchemaName, toJsonSchemaObject } from '../../schema/utils'
import { parseInvestigationResult } from './parseResult'
import { resolveApiKey } from '../resolveApiKey'
import type { OpenAiInvestigationConfig, ResultSchema } from '../../trypatchOptions'
import type { InvestigationProviderResult } from '../providerResult'
import { type LooseTool, toolsToOpenAiDefinitions } from '../toolAdapter'

type OpenAiToolCall = {
    id?: string
    type?: 'function'
    function?: {
        name?: string
        arguments?: string
    }
}

type OpenAiChatCompletionResponse = {
    choices?: {
        message?: {
            content?: string | null
            tool_calls?: OpenAiToolCall[]
        }
    }[]
    error?: {
        message?: string
    }
}

function resultToolNames (
    resultTools: LooseTool[] | undefined,
): Set<string> {
    return new Set(resultTools?.map(tool => tool.name) ?? [])
}

function parseResultToolCall (
    toolCalls: OpenAiToolCall[] | undefined,
    resultToolNameSet: Set<string>,
): InvestigationProviderResult | null {
    if (toolCalls === undefined || toolCalls.length === 0) {
        return null
    }

    const call = toolCalls.find(
        toolCall => toolCall.function?.name !== undefined
            && resultToolNameSet.has(toolCall.function.name),
    )

    if (!call?.function?.name) {
        return null
    }

    return {
        kind: 'result-tool',
        toolName: call.function.name,
        input: call.function.arguments ?? '{}',
    }
}

export async function investigateWithOpenAi (
    config: OpenAiInvestigationConfig,
    resultSchema: ResultSchema | undefined,
    prompts: { systemPrompt: string, userPrompt: string },
    timeoutMs: number,
    maxTokens: number | undefined,
    investigationTools: LooseTool[] | undefined,
    resultTools: LooseTool[] | undefined,
): Promise<InvestigationProviderResult> {
    const apiKey = await resolveApiKey(config.auth)
    const baseURL = (config.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const resultToolNameSet = resultToolNames(resultTools)
    const hasResultTools = resultToolNameSet.size > 0
    const openAiTools = toolsToOpenAiDefinitions([
        ...(investigationTools ?? []),
        ...(resultTools ?? []),
    ])

    try {
        const response = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                ...config.organization ? { 'OpenAI-Organization': config.organization } : {},
                ...config.project ? { 'OpenAI-Project': config.project } : {},
            },
            body: JSON.stringify({
                model: config.model ?? 'gpt-5.5',
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: prompts.systemPrompt },
                    { role: 'user', content: prompts.userPrompt },
                ],
                ...openAiTools ? { tools: openAiTools } : {},
                ...hasResultTools
                    ? { tool_choice: 'required' as const }
                    : resultSchema !== undefined
                        ? {
                            response_format: {
                                type: 'json_schema',
                                json_schema: {
                                    name: getSchemaName(resultSchema),
                                    strict: true,
                                    schema: toJsonSchemaObject(resultSchema),
                                },
                            },
                        }
                        : {},
            }),
        })

        const payload = await response.json() as OpenAiChatCompletionResponse

        if (!response.ok) {
            throw new Error(payload.error?.message ?? `OpenAI request failed with status ${response.status}`)
        }

        const message = payload.choices?.[0]?.message
        const resultToolResult = parseResultToolCall(message?.tool_calls, resultToolNameSet)
        if (resultToolResult) {
            return resultToolResult
        }

        const content = message?.content
        if (!content) {
            throw new Error('OpenAI response did not include message content or result tool call')
        }

        return {
            kind: 'result',
            result: parseInvestigationResult(resultSchema, JSON.parse(content)),
        }
    } finally {
        clearTimeout(timeout)
    }
}
