import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchConfigError } from '../../../errors'
import type { CustomErrorDefinition, ResultTool } from '../../../types'
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
import type { InvestigationOutcome } from './types'

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
}: {
    resultSchema?: Schema | undefined
    customErrors?: CustomErrorDefinition[] | undefined
    resultTools?: ResultTool<Schema, C>[] | undefined
    allowDirectResultCreation?: boolean | undefined
    allowCannotDetermine?: boolean | undefined
    allowUncertainResult?: boolean | undefined
    allowNoApplicableOutcome?: boolean | undefined
}) {
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

/**
 * Prompt text carrying the outcome schema, for providers that can't enforce it as structured output and
 * so only see it in the prompt.
 */
export function outcomeSchemaPrompt (outcomeSchema: JSONSchema): string {
    return `Return JSON matching this schema:\n${JSON.stringify(outcomeSchema, null, 2)}`
}

/**
 * Parses a provider's raw response text into its {@link InvestigationOutcome}, validating it against
 * `outcomeSchema`. The nested `result`/`errorSchema`/`input` payloads are validated against the caller's
 * actual schemas separately, in {@link investigateError}.
 */
export function parseProviderOutcome (content: string, outcomeSchema: JSONSchema): InvestigationOutcome {
    const parsed = parseWithSchema(outcomeSchema, JSON.parse(content), 'investigation outcome') as { outcome: InvestigationOutcome }
    return parsed.outcome
}
