import type { JSONSchema } from 'json-schema-to-ts'
import type {
    InvestigationContext,
    InvestigationProviderConfig,
    ResultTool,
    TryPatchOptions,
} from '../trypatchOptions'
import { buildInvestigationPrompt } from './buildPrompt'
import type { Schema } from '../schema/types'
import { parseWithSchema } from '../schema/utils'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
import { Providers } from './providers/types'
import { investigateWithClaude } from './providers/claude/investigate'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithOpenAi } from './providers/openai/investigate'
import type { InvestigationOutcome } from './resultSchema'
import { buildInvestigationResultSchema } from './resultSchema'
import { findToolByName, type LooseTool } from './toolAdapter'

const DEFAULT_TIMEOUT_MS = 300_000

async function callResultTool<S extends Schema, C> (
    tool: ResultTool<S, C>,
    input: unknown,
    toolContext: C | undefined,
): Promise<unknown> {
    return await tool.call(JSON.stringify(input ?? {}), toolContext)
}

async function callInvestigationProvider (
    investigationProvider: InvestigationProviderConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    timeoutMs: number,
    maxTokens: number | undefined,
    investigationTools: LooseTool[] | undefined,
): Promise<InvestigationOutcome> {
    switch (investigationProvider.provider) {
        case Providers.OPENAI:
            return await investigateWithOpenAi(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
                maxTokens,
                investigationTools,
            )
        case Providers.CURSOR:
            return await investigateWithCursor(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
            )
        case Providers.CLAUDE:
            return await investigateWithClaude(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
                maxTokens,
                investigationTools,
            )
        default: {
            const exhaustiveCheck: never = investigationProvider
            throw new Error(`Unsupported investigation provider: ${String(exhaustiveCheck)}`)
        }
    }
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
        customErrors,
    } = options.aiInvestigation
    const outcomeSchema = buildInvestigationResultSchema({ resultSchema, customErrors, resultTools })
    const builtPrompts = buildInvestigationPrompt(ctx, outcomeSchema, investigationBehavior)
    const { prompts, vault } = redactInvestigationPrompts(builtPrompts, redactConfig)
    const timeoutMs = investigationBehavior.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxTokens = investigationBehavior.maxTokens

    const rawOutcome = await callInvestigationProvider(
        investigationProvider,
        outcomeSchema,
        prompts,
        timeoutMs,
        maxTokens,
        investigationTools,
    )

    const outcome = restoreInvestigationResponse(rawOutcome, vault)

    switch (outcome.type) {
        case 'error': {
            const definition = customErrors?.find(candidate => candidate.errorConstructor.name === outcome.error)
            if (!definition) {
                throw new Error(`Investigation returned unregistered custom error: ${outcome.error}`)
            }

            throw new definition.errorConstructor(
                parseWithSchema(definition.errorParameterSchema, outcome.errorSchema, `${outcome.error} parameters`),
            )
        }
        case 'resultTool': {
            const tool = findToolByName(resultTools, outcome.toolName)
            if (!tool) {
                throw new Error(`Result tool ${outcome.toolName} is not registered`)
            }

            return await callResultTool(tool, outcome.input, toolContext)
        }
        case 'result':
            return parseWithSchema(resultSchema, outcome.result, 'investigation result')
    }
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
