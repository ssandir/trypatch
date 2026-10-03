import { setTimeout as sleep } from 'node:timers/promises'
import type { JSONSchema } from 'json-schema-to-ts'
import { withDeadline } from '../../../../abort/withDeadline'
import { Logger } from '../../../../logger'
import { extractJsonFromText } from '../../../../schema/utils'
import { resolveMcpServers } from '../../mcp/servers'
import type { ResolvedMcpServerConfig } from '../../mcp/types'
import { parseProviderOutcome, type InvestigationOutcome } from '../../resultSchema'
import { DEFAULT_BASE_URL, DEFAULT_POLL_INTERVAL_MS, TERMINAL_RUN_STATUSES } from './constants'
import type {
    CursorCreateAgentResponse,
    CursorInvestigationConfig,
    CursorInvestigationOptions,
    CursorRunResponse,
} from './types'

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

// Cursor connects to the servers itself, from its cloud VM.
function buildCursorMcpServer (server: ResolvedMcpServerConfig): Record<string, unknown> {
    if (server.type === 'stdio') {
        return {
            name: server.name,
            type: 'stdio',
            command: server.command,
            ...server.args ? { args: server.args } : {},
            ...server.env ? { env: server.env } : {},
        }
    }

    return {
        name: server.name,
        type: server.type,
        url: server.url,
        ...server.headers ? { headers: server.headers } : {},
    }
}

async function buildCreateAgentBody (
    config: CursorInvestigationConfig,
    prompts: { systemPrompt: string, userPrompt: string },
    options: CursorInvestigationOptions,
): Promise<Record<string, unknown>> {
    const model = buildCursorModel(config)
    const repos = buildCursorRepos(config)
    const mcpServers = await resolveMcpServers(options.mcpServers ?? [], options.logger ?? new Logger())

    return {
        prompt: {
            text: `${prompts.systemPrompt}\n\n${prompts.userPrompt}`,
        },
        ...model ? { model } : {},
        ...repos ? { repos } : {},
        ...mcpServers.length > 0 ? { mcpServers: mcpServers.map(buildCursorMcpServer) } : {},
    }
}

async function createCursorAgent (
    baseURL: string,
    authorization: string,
    body: Record<string, unknown>,
    doFetch: typeof fetch,
    signal: AbortSignal,
): Promise<{ agentId: string, runId: string }> {
    const createResponse = await doFetch(`${baseURL}/v1/agents`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
        },
        body: JSON.stringify(body),
        signal,
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
    doFetch: typeof fetch,
    signal: AbortSignal,
): Promise<InvestigationOutcome> {
    for (;;) {
        const runResponse = await doFetch(`${baseURL}/v1/agents/${agentId}/runs/${runId}`, {
            headers: {
                Authorization: authorization,
            },
            signal,
        })

        const runPayload = await runResponse.json() as CursorRunResponse

        if (!runResponse.ok) {
            throw new Error(runPayload.error?.message ?? `Cursor run lookup failed with status ${runResponse.status}`)
        }

        const result = parseTerminalRunResult(runPayload, outcomeSchema)
        if (result !== null) {
            return result
        }

        await sleep(pollIntervalMs, undefined, { signal })
    }
}

export async function investigateWithCursor (
    config: CursorInvestigationConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: CursorInvestigationOptions,
): Promise<InvestigationOutcome> {
    const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const authorization = buildAuthorizationHeader(config.apiKey)
    const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const doFetch = config.fetch ?? fetch

    return await withDeadline(async (signal) => {
        const { agentId, runId } = await createCursorAgent(
            baseURL,
            authorization,
            await buildCreateAgentBody(config, prompts, options),
            doFetch,
            signal,
        )

        return await pollCursorRun(
            baseURL,
            authorization,
            agentId,
            runId,
            outcomeSchema,
            pollIntervalMs,
            doFetch,
            signal,
        )
    }, { signal: options.signal, timeout: { ms: options.timeoutMs, label: 'Investigation' } })
}
