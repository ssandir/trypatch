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
    ResultTool,
} from '../../types'
import type { Logger } from '../../logger'
import { buildInvestigationPrompt } from './buildPrompt'
import { qualifiedMethodName } from '../investigationContext'
import { validateMcpServers } from './mcp/servers'
import type { Schema, SchemaInfer } from '../../schema/types'
import { parseWithSchema } from '../../schema/utils'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
import { investigateWithCursor } from './providers/cursor/investigate'
import { investigateWithLanguageModel } from './providers/languageModel/investigate'
import type { LanguageModelInvestigationOptions } from './providers/languageModel/types'
import type { InvestigationOutcome } from './resultSchema'
import { buildInvestigationResultSchema } from './resultSchema'
import { findToolByName } from './toolAdapter'

async function callResultTool<S extends Schema, C> (
    tool: ResultTool<S, C>,
    input: unknown,
    toolContext: C | undefined,
    signal: AbortSignal | undefined,
): Promise<unknown> {
    return await tool.call(JSON.stringify(input ?? {}), toolContext, { signal })
}

async function resolveOutcome<S extends Schema, C> (
    outcome: InvestigationOutcome,
    resultSchema: S | undefined,
    customErrors: CustomErrorDefinition[] | undefined,
    resultTools: ResultTool<S, C>[] | undefined,
    toolContext: C | undefined,
    signal: AbortSignal | undefined,
): Promise<{ result: unknown, explanation: string }> {
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

            return {
                result: await callResultTool(tool, outcome.input, toolContext, signal),
                explanation: outcome.explanation,
            }
        }
        case 'result':
            return {
                result: parseWithSchema(resultSchema, outcome.result, 'investigation result'),
                explanation: outcome.explanation,
            }
        case 'cannotDetermine':
            throw new TrypatchCannotDetermineError(outcome.reason)
        case 'uncertain':
            throw new TrypatchUncertainResultError(outcome.reason)
        case 'noApplicableOutcome':
            throw new TrypatchNoApplicableOutcomeError(outcome.reason)
    }
}

async function callInvestigationProvider (
    investigationProvider: InvestigationProviderConfig,
    outcomeSchema: JSONSchema,
    prompts: { systemPrompt: string, userPrompt: string },
    options: LanguageModelInvestigationOptions,
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
        allowDirectResultCreation,
        allowCannotDetermine,
        allowUncertainResult,
        allowNoApplicableOutcome,
        onInvestigationResult,
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
        allowDirectResultCreation,
        allowCannotDetermine,
        allowUncertainResult,
        allowNoApplicableOutcome,
    })
    const builtPrompts = buildInvestigationPrompt(ctx, sanitizedArgs, outcomeSchema, investigationBehavior)
    const { prompts, vault } = redactInvestigationPrompts(builtPrompts, redactConfig)
    const rawOutcome = await callInvestigationProvider(investigationProvider, outcomeSchema, prompts, {
        maxTokens: investigationBehavior.maxTokens,
        maxToolIterations: investigationBehavior.maxToolIterations,
        investigationTools,
        toolContext,
        vault,
        mcpServers,
        logger,
        signal,
    })

    const outcome = restoreInvestigationResponse(rawOutcome, vault)
    const { result, explanation } = await resolveOutcome(outcome, resultSchema, customErrors, resultTools, toolContext, signal)

    logger?.info(`[ssandir/trypatch] Investigation of ${qualifiedMethodName(ctx)} returned a result`, explanation)

    if (onInvestigationResult) {
        await Promise.resolve(onInvestigationResult(result as SchemaInfer<S>, { explanation }))
    }

    return result
}
