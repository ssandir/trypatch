import type {
    InvestigationContext,
    ResultTool,
    ResultSchema,
    TryPatchOptions,
} from '../trypatchOptions'
import { buildInvestigationPrompt } from './buildPrompt'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
import { investigateWithCursor } from './providers/cursor'
import { investigateWithOpenAi } from './providers/openai'
import { findToolByName } from './toolAdapter'

const DEFAULT_TIMEOUT_MS = 60_000

async function callResultTool<S extends ResultSchema, C> (
    tool: ResultTool<S, C>,
    input: string,
    toolContext: C | undefined,
): Promise<unknown> {
    return await tool.call(input, toolContext)
}

export async function investigateError<
    S extends ResultSchema,
    C = unknown,
> (
    ctx: InvestigationContext,
    options: TryPatchOptions<S, C>,
): Promise<unknown> {
    if ('investigate' in options) {
        return await options.investigate(ctx)
    }

    const {
        resultSchema,
        investigationProvider,
        investigationBehavior = {},
        redactConfig,
        toolContext,
        investigationTools,
        resultTools,
    } = options
    const builtPrompts = buildInvestigationPrompt(ctx, resultSchema, investigationBehavior)
    const { prompts, vault } = redactInvestigationPrompts(builtPrompts, redactConfig)
    const timeoutMs = investigationBehavior.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxTokens = investigationBehavior.maxTokens

    const providerResult = investigationProvider.provider === 'openai'
        ? await investigateWithOpenAi(
            investigationProvider,
            resultSchema,
            prompts,
            timeoutMs,
            maxTokens,
            investigationTools,
            resultTools,
        )
        : await investigateWithCursor(
            investigationProvider,
            resultSchema,
            prompts,
            timeoutMs,
            investigationTools,
            resultTools,
        )

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
