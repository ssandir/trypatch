import type {
    InvestigationContext,
    ResultTool,
    Schema,
    TryPatchOptions,
} from '../trypatchOptions'
import { buildInvestigationPrompt } from './buildPrompt'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
import { Providers } from './providers/types'
import { investigateWithClaude } from './providers/claude/investigate'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithOpenAi } from './providers/openai/investigate'
import { findToolByName } from './toolAdapter'

const DEFAULT_TIMEOUT_MS = 60_000

async function callResultTool<S extends Schema, C> (
    tool: ResultTool<S, C>,
    input: string,
    toolContext: C | undefined,
): Promise<unknown> {
    return await tool.call(input, toolContext)
}

export async function investigateError<
    S extends Schema,
    C = unknown,
> (
    ctx: InvestigationContext,
    options: TryPatchOptions<S, C>,
): Promise<unknown> {
    if ('customInvestigation' in options) {
        return await options.customInvestigation.investigate(ctx)
    }

    const {
        resultSchema,
        investigationProvider,
        investigationBehavior = {},
        redactConfig,
        toolContext,
        investigationTools,
        resultTools,
    } = options.aiInvestigation
    const builtPrompts = buildInvestigationPrompt(ctx, resultSchema, investigationBehavior)
    const { prompts, vault } = redactInvestigationPrompts(builtPrompts, redactConfig)
    const timeoutMs = investigationBehavior.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxTokens = investigationBehavior.maxTokens

    const providerResult = await (async () => {
        switch (investigationProvider.provider) {
            case Providers.OPENAI:
                return await investigateWithOpenAi(
                    investigationProvider,
                    resultSchema,
                    prompts,
                    timeoutMs,
                    maxTokens,
                    investigationTools,
                    resultTools,
                )
            case Providers.CURSOR:
                return await investigateWithCursor(
                    investigationProvider,
                    resultSchema,
                    prompts,
                    timeoutMs,
                    investigationTools,
                    resultTools,
                )
            case Providers.CLAUDE:
                return await investigateWithClaude(
                    investigationProvider,
                    resultSchema,
                    prompts,
                    timeoutMs,
                    maxTokens,
                    investigationTools,
                    resultTools,
                )
            default: {
                const exhaustiveCheck: never = investigationProvider
                throw new Error(`Unsupported investigation provider: ${String(exhaustiveCheck)}`)
            }
        }
    })()

    if (providerResult.kind === 'result-tool') {
        const tool = findToolByName(resultTools, providerResult.toolName)
        if (!tool) {
            throw new Error(`Result tool ${providerResult.toolName} is not registered`)
        }

        return await callResultTool(
            tool,
            restoreInvestigationResponse(providerResult.input, vault),
            toolContext,
        )
    }

    return restoreInvestigationResponse(providerResult.result, vault)
}

export function buildInvestigationContext (
    error: unknown,
    context: ClassMethodDecoratorContext<unknown, (...args: unknown[]) => unknown>,
    args: unknown[],
    sanitizeArgs?: (args: unknown[]) => unknown[],
): InvestigationContext {
    return {
        error,
        methodName: String(context.name),
        args,
        sanitizedArgs: sanitizeArgs ? sanitizeArgs(args) : args,
    }
}
