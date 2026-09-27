import type { JSONSchema } from 'json-schema-to-ts'
import { parseProviderOutcome } from '../../providerResult'
import { resolveApiKey } from '../../resolveApiKey'
import type { InvestigationOutcome } from '../../resultSchema'
import { type LooseTool } from '../../toolAdapter'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './constants'
import { toolsToOpenAiDefinitions } from './toolAdapter'
import type { OpenAiChatCompletionResponse, OpenAiInvestigationConfig } from './types'

export async function investigateWithOpenAi (
    config: OpenAiInvestigationConfig,
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
    const openAiTools = toolsToOpenAiDefinitions(investigationTools)

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
                model: config.model ?? DEFAULT_MODEL,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: prompts.systemPrompt },
                    { role: 'user', content: prompts.userPrompt },
                ],
                ...openAiTools ? { tools: openAiTools } : {},
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'InvestigationOutcome',
                        strict: true,
                        schema: outcomeSchema,
                    },
                },
            }),
        })

        const payload = await response.json() as OpenAiChatCompletionResponse

        if (!response.ok) {
            throw new Error(payload.error?.message ?? `OpenAI request failed with status ${response.status}`)
        }

        const content = payload.choices?.[0]?.message?.content
        if (!content) {
            throw new Error('OpenAI response did not include message content')
        }

        return parseProviderOutcome(content)
    } finally {
        clearTimeout(timeout)
    }
}
