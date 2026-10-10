import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchConfigError } from '../../../errors'
import type { AiInvestigationOptions } from '../../../types'
import type { Schema } from '../../../schema/types'
import { parseWithSchema } from '../../../schema/utils'
import {
    cannotDetermineOutcomeVariant,
    errorOutcomeVariant,
    explicitResultOutcomeVariant,
    noApplicableOutcomeVariant,
    resultToolOutcomeVariant,
    uncertainOutcomeVariant,
} from './outcomeVariants'
import type { InvestigationOutcome, OutcomeSchemaOptions } from './types'

/**
 * Builds a strict-mode-compatible JSON Schema (per OpenAI's structured outputs rules: object root,
 * `additionalProperties: false` and fully `required` properties throughout, union variants nested
 * under a property rather than at the schema root) describing the {@link InvestigationOutcome}
 * a provider's structured output must produce.
 */
export function buildInvestigationResultSchema<C> ({
    resultSchema,
    customErrors,
    resultTools,
    allowDirectResultCreation = true,
    allowCannotDetermine = true,
    allowUncertainResult = true,
    allowNoApplicableOutcome = true,
}: OutcomeSchemaOptions<C>) {
    const variants = [
        ...(customErrors ?? []).map(errorOutcomeVariant),
        ...(resultTools ?? []).map(resultToolOutcomeVariant),
        ...allowDirectResultCreation ? [explicitResultOutcomeVariant(resultSchema)] : [],
        ...allowCannotDetermine ? [cannotDetermineOutcomeVariant] : [],
        ...allowUncertainResult ? [uncertainOutcomeVariant] : [],
        ...allowNoApplicableOutcome ? [noApplicableOutcomeVariant] : [],
    ]

    if (variants.length === 0) {
        throw new TrypatchConfigError('AI investigation has no possible outcome.')
    }

    return {
        type: 'object',
        properties: {
            outcome: variants.length === 1 ? variants[0]! : { anyOf: variants },
        },
        required: ['outcome'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

const ANY_PAYLOAD = {} as const satisfies JSONSchema

/**
 * {@link buildInvestigationResultSchema} with every payload (`result`, `input`, `errorSchema`) accepting anything, for
 * validating a provider's response. Payloads are parsed with the consumer's own schemas when the outcome is applied, so a
 * Zod schema is never validated through its JSON Schema conversion, which Ajv can't compile (Zod emits `format`s).
 */
export function buildInvestigationResultEnvelopeSchema<C> (options: OutcomeSchemaOptions<C>) {
    return buildInvestigationResultSchema({
        ...options,
        resultSchema: ANY_PAYLOAD,
        resultTools: options.resultTools?.map(tool => ({ ...tool, parameters: ANY_PAYLOAD })),
        customErrors: options.customErrors?.map(definition => ({ ...definition, errorParameterSchema: ANY_PAYLOAD })),
    })
}

/** The outcome schema builders' inputs, picked from the decorator's AI investigation options. */
export function outcomeSchemaOptions<S extends Schema, C> (
    { resultSchema, customErrors, resultTools, investigationBehavior = {} }: AiInvestigationOptions<S, C>,
): OutcomeSchemaOptions<C> {
    return {
        resultSchema,
        customErrors,
        resultTools,
        allowDirectResultCreation: investigationBehavior.allowDirectResultCreation,
        allowCannotDetermine: investigationBehavior.allowCannotDetermine,
        allowUncertainResult: investigationBehavior.allowUncertainResult,
        allowNoApplicableOutcome: investigationBehavior.allowNoApplicableOutcome,
    }
}

/**
 * Prompt text carrying the outcome schema, for providers that can't enforce it as structured output and
 * so only see it in the prompt.
 */
export function outcomeSchemaPrompt (outcomeSchema: JSONSchema): string {
    return `Return JSON matching this schema:\n${JSON.stringify(outcomeSchema, null, 2)}`
}

/** Validates a provider's response against the {@link buildInvestigationResultEnvelopeSchema | envelope} and returns its {@link InvestigationOutcome}. */
export function parseProviderOutcome (response: unknown, envelopeSchema: JSONSchema): InvestigationOutcome {
    const parsed = parseWithSchema(envelopeSchema, response, 'investigation outcome') as { outcome: InvestigationOutcome }
    return parsed.outcome
}
