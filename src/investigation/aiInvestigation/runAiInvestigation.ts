import type { JSONSchema } from 'json-schema-to-ts'
import {
    TrypatchCannotDetermineError,
    TrypatchNoApplicableOutcomeError,
    TrypatchUncertainResultError,
} from '../../errors'
import type {
    AiInvestigationOptions,
    CustomErrorDefinition,
    InvestigationContext,
    InvestigationProviderConfig,
    ResolvedOutcome,
    ResultTool,
} from '../../types'
import type { Logger } from '../../logger'
import { buildInvestigationPrompt } from './buildPrompt'
import { qualifiedMethodName } from '../investigationContext'
import { validateMcpServers } from './mcp/servers'
import type { Schema, SchemaInfer } from '../../schema/types'
import { parseParameter, parseWithSchema } from '../../schema/utils'
import { withSafeToolbox } from '../../tools/builtin'
import { callTool } from '../../tools/tool'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithLanguageModel } from './providers/languageModel/investigate'
import type { LanguageModelInvestigationOptions } from './providers/languageModel/types'
import type { InvestigationOutcome } from './resultSchema'
import { buildInvestigationResultSchema } from './resultSchema'

async function applyOutcome<S extends Schema, C> (
    outcome: InvestigationOutcome,
    resultSchema: S | undefined,
    customErrors: CustomErrorDefinition[] | undefined,
    resultTools: ResultTool<S, C>[] | undefined,
    toolContext: C | undefined,
    signal: AbortSignal | undefined,
): Promise<SchemaInfer<S>> {
    switch (outcome.type) {
        case 'error': {
            const definition = customErrors?.find(candidate => candidate.errorConstructor.name === outcome.error)
            if (!definition) {
                throw new Error(`Investigation returned unregistered custom error: ${outcome.error}`)
            }

            throw new definition.errorConstructor(
                parseParameter(definition.errorParameterSchema, outcome.errorSchema, `${outcome.error} parameters`),
            )
        }
        case 'resultTool': {
            const tool = resultTools?.find(resultTool => resultTool.name === outcome.toolName)
            if (!tool) {
                throw new Error(`Result tool ${outcome.toolName} is not registered`)
            }

            return await callTool(tool, outcome.input, toolContext, { signal })
        }
        case 'result':
            return parseWithSchema(resultSchema, outcome.result, 'investigation result') as SchemaInfer<S>
        case 'cannotDetermine':
            throw new TrypatchCannotDetermineError(outcome.reason)
        case 'uncertain':
            throw new TrypatchUncertainResultError(outcome.reason)
        case 'noApplicableOutcome':
            throw new TrypatchNoApplicableOutcomeError(outcome.reason)
    }
}

// Never throws, so onAiInvestigationEnd sees the AI's explanation alongside whatever error the outcome ends with.
async function resolveOutcome<S extends Schema, C> (
    outcome: InvestigationOutcome,
    resultSchema: S | undefined,
    customErrors: CustomErrorDefinition[] | undefined,
    resultTools: ResultTool<S, C>[] | undefined,
    toolContext: C | undefined,
    signal: AbortSignal | undefined,
): Promise<ResolvedOutcome<SchemaInfer<S>>> {
    signal?.throwIfAborted()
    try {
        return {
            type: 'result',
            result: await applyOutcome(outcome, resultSchema, customErrors, resultTools, toolContext, signal),
            explanation: outcome.explanation,
        }
    } catch (error) {
        return {
            type: 'error',
            error: error instanceof Error ? error : new Error(String(error), { cause: error }),
            explanation: outcome.explanation,
        }
    }
}

async function callInvestigationProvider<C> (
    investigationProvider: InvestigationProviderConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: LanguageModelInvestigationOptions<C>,
): Promise<InvestigationOutcome> {
    if (investigationProvider.provider === 'cursor') {
        return await investigateWithCursor(investigationProvider, outcomeSchema, prompts, options)
    }

    return await investigateWithLanguageModel(investigationProvider, outcomeSchema, prompts, options)
}

export async function runAiInvestigation<S extends Schema, C> (
    ctx: InvestigationContext,
    {
        resultSchema,
        investigationProvider,
        investigationBehavior = {},
        redactConfig,
        toolContext,
        investigationTools,
        mcpServers,
        resultTools,
        customErrors,
        onAiInvestigationEnd,
    }: AiInvestigationOptions<S, C>,
    logger?: Logger,
    signal?: AbortSignal,
): Promise<unknown> {
    validateMcpServers(mcpServers, investigationProvider.provider)

    const sanitizedArgs = investigationBehavior.sanitizeArgs
        ? investigationBehavior.sanitizeArgs(ctx.args)
        : ctx.args
    const outcomeSchema = buildInvestigationResultSchema({
        resultSchema,
        customErrors,
        resultTools,
        allowDirectResultCreation: investigationBehavior.allowDirectResultCreation,
        allowCannotDetermine: investigationBehavior.allowCannotDetermine,
        allowUncertainResult: investigationBehavior.allowUncertainResult,
        allowNoApplicableOutcome: investigationBehavior.allowNoApplicableOutcome,
    })
    const builtPrompts = buildInvestigationPrompt(ctx, sanitizedArgs, investigationBehavior)
    const { prompts, vault } = redactInvestigationPrompts(builtPrompts, redactConfig)
    const rawOutcome = await callInvestigationProvider(investigationProvider, outcomeSchema, prompts, {
        maxTokens: investigationBehavior.maxTokens,
        investigationTools: withSafeToolbox({ error: ctx.error, args: sanitizedArgs }, investigationTools, investigationBehavior.allowSafeToolbox),
        toolContext,
        vault,
        mcpServers,
        logger,
        signal,
    })

    const outcome = restoreInvestigationResponse(rawOutcome, vault)
    const resolved = await resolveOutcome(outcome, resultSchema, customErrors, resultTools, toolContext, signal)
    
    signal?.throwIfAborted()

    logger?.info(`[ssandir/trypatch] Investigation of ${qualifiedMethodName(ctx)} ended with outcome ${resolved.type}`, resolved.explanation)

    await onAiInvestigationEnd?.(ctx, resolved)

    if (resolved.type === 'error') {
        throw resolved.error
    }

    return resolved.result
}
