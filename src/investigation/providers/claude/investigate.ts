import { toJsonSchemaObject } from '../../../schema/utils'
import { parseInvestigationResult } from '../parseResult'
import { resolveApiKey } from '../../resolveApiKey'
import type { Schema } from '../../../trypatchOptions'
import type { InvestigationProviderResult } from '../../providerResult'
import { type LooseTool } from '../../toolAdapter'
import { DEFAULT_API_VERSION, DEFAULT_BASE_URL, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from './constants'
import { toolsToClaudeDefinitions } from './toolAdapter'
import type { ClaudeContentBlock, ClaudeInvestigationConfig, ClaudeMessagesResponse } from './types'

function resultToolNames (
    resultTools: LooseTool[] | undefined,
): Set<string> {
    return new Set(resultTools?.map(tool => tool.name) ?? [])
}

function stringifyToolInput (input: unknown): string {
    if (typeof input === 'string') {
        return input
    }

    return JSON.stringify(input ?? {})
}

function parseResultToolCall (
    content: ClaudeContentBlock[] | undefined,
    resultToolNameSet: Set<string>,
): InvestigationProviderResult | null {
    if (content === undefined || content.length === 0) {
        return null
    }

    const call = content.find(
        (block): block is Extract<ClaudeContentBlock, { type: 'tool_use' }> =>
            block.type === 'tool_use'
            && typeof block.name === 'string'
            && resultToolNameSet.has(block.name),
    )

    if (!call?.name) {
        return null
    }

    return {
        kind: 'result-tool',
        toolName: call.name,
        input: stringifyToolInput(call.input),
    }
}

function extractTextContent (content: ClaudeContentBlock[] | undefined): string | undefined {
    const text = content
        ?.filter((block): block is Extract<ClaudeContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text ?? '')
        .join('')

    return text === undefined || text.length === 0 ? undefined : text
}

export async function investigateWithClaude (
    config: ClaudeInvestigationConfig,
    resultSchema: Schema | undefined,
    prompts: { systemPrompt: string, userPrompt: string },
    timeoutMs: number,
    maxTokens: number | undefined,
    investigationTools: LooseTool[] | undefined,
    resultTools: LooseTool[] | undefined,
): Promise<InvestigationProviderResult> {
    const apiKey = await resolveApiKey(config.auth)
    const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const resultToolNameSet = resultToolNames(resultTools)
    const hasResultTools = resultToolNameSet.size > 0
    const claudeTools = toolsToClaudeDefinitions([
        ...(investigationTools ?? []),
        ...(resultTools ?? []),
    ])

    try {
        const response = await fetch(`${baseURL}/v1/messages`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': config.apiVersion ?? DEFAULT_API_VERSION,
            },
            body: JSON.stringify({
                model: config.model ?? DEFAULT_MODEL,
                max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
                system: prompts.systemPrompt,
                messages: [
                    { role: 'user', content: prompts.userPrompt },
                ],
                ...claudeTools ? { tools: claudeTools } : {},
                ...hasResultTools
                    ? { tool_choice: { type: 'any' as const } }
                    : resultSchema !== undefined
                        ? {
                            output_config: {
                                format: {
                                    type: 'json_schema',
                                    schema: toJsonSchemaObject(resultSchema),
                                },
                            },
                        }
                        : {},
            }),
        })

        const payload = await response.json() as ClaudeMessagesResponse

        if (!response.ok) {
            throw new Error(payload.error?.message ?? `Claude request failed with status ${response.status}`)
        }

        const resultToolResult = parseResultToolCall(payload.content, resultToolNameSet)
        if (resultToolResult) {
            return resultToolResult
        }

        const content = extractTextContent(payload.content)
        if (!content) {
            throw new Error('Claude response did not include message content or result tool call')
        }

        return {
            kind: 'result',
            result: parseInvestigationResult(resultSchema, JSON.parse(content)),
        }
    } finally {
        clearTimeout(timeout)
    }
}
