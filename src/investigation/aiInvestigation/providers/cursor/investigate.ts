import type { JSONSchema } from 'json-schema-to-ts'
import { extractJsonFromText } from '../../../../schema/utils'
import { parseProviderOutcome, type InvestigationOutcome } from '../../resultSchema'
import { DEFAULT_BASE_URL, DEFAULT_POLL_INTERVAL_MS, TERMINAL_RUN_STATUSES } from './constants'
import type { CursorCreateAgentResponse, CursorInvestigationConfig, CursorRunResponse } from './types'

function buildAuthorizationHeader (apiKey: string): string {
    if (apiKey.startsWith('Bearer ')) {
        return apiKey
    }

    const encoded = Buffer.from(`${apiKey}:`, 'utf8').toString('base64')
    return `Basic ${encoded}`
}

function buildCursorModel (config: CursorInvestigationConfig): Record<string, unknown> | undefined {
    if (!config.model) {
        return undefined
    }

    if (typeof config.model === 'string') {
        return { id: config.model }
    }

    return {
        id: config.model.id,
        ...config.model.params ? { params: config.model.params } : {},
    }
}

function buildCursorRepos (config: CursorInvestigationConfig): Record<string, string>[] | undefined {
    if (!config.repository) {
        return undefined
    }

    return [
        {
            url: config.repository.url,
            ...config.repository.startingRef ? { startingRef: config.repository.startingRef } : {},
            ...config.repository.prUrl ? { prUrl: config.repository.prUrl } : {},
        },
    ]
}

function buildCreateAgentBody (
    config: CursorInvestigationConfig,
    prompts: { systemPrompt: string, userPrompt: string },
): Record<string, unknown> {
    const model = buildCursorModel(config)
    const repos = buildCursorRepos(config)

    return {
        prompt: {
            text: `${prompts.systemPrompt}\n\n${prompts.userPrompt}`,
        },
        ...model ? { model } : {},
        ...repos ? { repos } : {},
    }
}

async function createCursorAgent (
    baseURL: string,
    authorization: string,
    body: Record<string, unknown>,
    doFetch: typeof fetch,
): Promise<{ agentId: string, runId: string }> {
    const createResponse = await doFetch(`${baseURL}/v1/agents`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
        },
        body: JSON.stringify(body),
    })

    const createPayload = await createResponse.json() as CursorCreateAgentResponse

    if (!createResponse.ok) {
        throw new Error(createPayload.error?.message ?? `Cursor agent creation failed with status ${createResponse.status}`)
    }

    const agentId = createPayload.agent?.id
    const runId = createPayload.run?.id

    if (!agentId || !runId) {
        throw new Error('Cursor agent creation response did not include agent and run identifiers')
    }

    return { agentId, runId }
}

function parseTerminalRunResult (
    runPayload: CursorRunResponse,
    outcomeSchema: JSONSchema,
): InvestigationOutcome | null {
    const status = runPayload.status?.toUpperCase()

    if (!status || !TERMINAL_RUN_STATUSES.has(status)) {
        return null
    }

    if (status !== 'FINISHED') {
        throw new Error(`Cursor investigation run ended with status ${status}`)
    }

    if (!runPayload.result) {
        throw new Error('Cursor investigation run finished without a result')
    }

    return parseProviderOutcome(JSON.stringify(extractJsonFromText(runPayload.result)), outcomeSchema)
}

async function pollCursorRun (
    baseURL: string,
    authorization: string,
    agentId: string,
    runId: string,
    outcomeSchema: JSONSchema,
    pollIntervalMs: number,
    deadline: number,
    timeoutMs: number,
    doFetch: typeof fetch,
): Promise<InvestigationOutcome> {
    while (Date.now() < deadline) {
        const runResponse = await doFetch(`${baseURL}/v1/agents/${agentId}/runs/${runId}`, {
            headers: {
                Authorization: authorization,
            },
        })

        const runPayload = await runResponse.json() as CursorRunResponse

        if (!runResponse.ok) {
            throw new Error(runPayload.error?.message ?? `Cursor run lookup failed with status ${runResponse.status}`)
        }

        const result = parseTerminalRunResult(runPayload, outcomeSchema)
        if (result !== null) {
            return result
        }

        await sleep(pollIntervalMs)
    }

    throw new Error(`Cursor investigation timed out after ${timeoutMs}ms`)
}

export async function investigateWithCursor (
    config: CursorInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    timeoutMs: number,
): Promise<InvestigationOutcome> {
    const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const authorization = buildAuthorizationHeader(config.apiKey)
    const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const deadline = Date.now() + timeoutMs
    const doFetch = config.fetch ?? fetch

    const { agentId, runId } = await createCursorAgent(
        baseURL,
        authorization,
        buildCreateAgentBody(config, prompts),
        doFetch,
    )

    return await pollCursorRun(
        baseURL,
        authorization,
        agentId,
        runId,
        outcomeSchema,
        pollIntervalMs,
        deadline,
        timeoutMs,
        doFetch,
    )
}

function sleep (ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}
