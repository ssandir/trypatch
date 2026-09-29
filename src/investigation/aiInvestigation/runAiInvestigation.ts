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
import { buildInvestigationPrompt } from './buildPrompt'
import type { Schema, SchemaInfer } from '../../schema/types'
import { parseWithSchema } from '../../schema/utils'
import { redactInvestigationPrompts, restoreInvestigationResponse } from './redact/flareRedact'
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

async function resolveOutcome<S extends Schema, C> (
    outcome: InvestigationOutcome,
    resultSchema: S | undefined,
    customErrors: CustomErrorDefinition[] | undefined,
    resultTools: ResultTool<S, C>[] | undefined,
    toolContext: C | undefined,
): Promise<unknown> {
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
    timeoutMs: number,
    maxTokens: number | undefined,
    investigationTools: LooseTool[] | undefined,
): Promise<InvestigationOutcome> {
    switch (investigationProvider.provider) {
        case 'openai':
            return await investigateWithOpenAi(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
                maxTokens,
                investigationTools,
            )
        case 'cursor':
            return await investigateWithCursor(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
            )
        case 'claude':
            return await investigateWithClaude(
                investigationProvider,
                outcomeSchema,
                prompts,
                timeoutMs,
                maxTokens,
                investigationTools,
            )
    }
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
        resultTools,
        customErrors,
        allowDirectResultCreation,
        allowCannotDetermine,
        allowUncertainResult,
        allowNoApplicableOutcome,
        onInvestigationResult,
    }: AiInvestigationOptions<S, C>,
): Promise<unknown> {
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
    const result = await resolveOutcome(outcome, resultSchema, customErrors, resultTools, toolContext)

    if (onInvestigationResult) {
        await Promise.resolve(onInvestigationResult(result as SchemaInfer<S>))
    }

    return result
}
