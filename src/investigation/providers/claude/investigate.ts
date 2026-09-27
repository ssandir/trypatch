import type { JSONSchema } from 'json-schema-to-ts'
import { parseProviderOutcome } from '../../providerResult'
import { resolveApiKey } from '../../resolveApiKey'
import type { InvestigationOutcome } from '../../resultSchema'
import { type LooseTool } from '../../toolAdapter'
import { DEFAULT_API_VERSION, DEFAULT_BASE_URL, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from './constants'
import { toolsToClaudeDefinitions } from './toolAdapter'
import type { ClaudeContentBlock, ClaudeInvestigationConfig, ClaudeMessagesResponse } from './types'

function extractTextContent (content: ClaudeContentBlock[] | undefined): string | undefined {
    const text = content
        ?.filter((block): block is Extract<ClaudeContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text ?? '')
        .join('')

    return text === undefined || text.length === 0 ? undefined : text
}

export async function investigateWithClaude (
    config: ClaudeInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    timeoutMs: number,
    maxTokens: number | undefined,
    investigationTools: LooseTool[] | undefined,
): Promise<InvestigationOutcome> {
    const apiKey = await resolveApiKey(config.auth)
    const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const claudeTools = toolsToClaudeDefinitions(investigationTools)

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
                output_config: {
                    format: {
                        type: 'json_schema',
                        schema: outcomeSchema,
                    },
                },
            }),
        })

        const payload = await response.json() as ClaudeMessagesResponse

        if (!response.ok) {
            throw new Error(payload.error?.message ?? `Claude request failed with status ${response.status}`)
        }

        const content = extractTextContent(payload.content)
        if (!content) {
            throw new Error('Claude response did not include message content')
        }

        return parseProviderOutcome(content)
    } finally {
        clearTimeout(timeout)
    }
}
