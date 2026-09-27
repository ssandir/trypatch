import type { JSONSchema } from 'json-schema-to-ts'
import type { CustomErrorDefinition } from '../../../types'
import type { Schema } from '../../../schema/types'
import { parseWithSchema, toJsonSchemaObject } from '../../../schema/utils'
import type { LooseTool } from '../toolAdapter'
import type { InvestigationOutcome } from './types'

function errorOutcomeVariant (definition: CustomErrorDefinition) {
    return {
        type: 'object',
        ...definition.description !== undefined ? { description: definition.description } : {},
        properties: {
            type: { enum: ['error'] },
            error: { enum: [definition.errorConstructor.name] },
            errorSchema: toJsonSchemaObject(definition.errorParameterSchema),
        },
        required: ['type', 'error', 'errorSchema'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

function resultToolOutcomeVariant (tool: LooseTool) {
    return {
        type: 'object',
        properties: {
            type: { enum: ['resultTool'] },
            toolName: { enum: [tool.name] },
            input: tool.parameters,
        },
        required: ['type', 'toolName', 'input'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

function explicitResultOutcomeVariant (resultSchema: Schema | undefined) {
    return {
        type: 'object',
        properties: {
            type: { enum: ['result'] },
            result: resultSchema !== undefined
                ? toJsonSchemaObject(resultSchema)
                : {
                    type: 'string',
                    description: 'A JSON-encoded string representing the investigation result. It will be parsed with JSON.parse.',
                },
        },
        required: ['type', 'result'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

/**
 * Builds a strict-mode-compatible JSON Schema (per OpenAI's structured outputs rules: object root,
 * `additionalProperties: false` and fully `required` properties throughout, union variants nested
 * under a property rather than at the schema root) describing the {@link InvestigationOutcome}
 * a provider's structured output must produce.
 */
export function buildInvestigationResultSchema ({
    resultSchema,
    customErrors,
    resultTools,
    allowDirectResultCreation = true,
}: {
    resultSchema?: Schema | undefined
    customErrors?: CustomErrorDefinition[] | undefined
    resultTools?: LooseTool[] | undefined
    allowDirectResultCreation?: boolean | undefined
}) {
    const variants = [
        ...(customErrors ?? []).map(errorOutcomeVariant),
        ...(resultTools ?? []).map(resultToolOutcomeVariant),
        ...allowDirectResultCreation ? [explicitResultOutcomeVariant(resultSchema)] : [],
    ]

    if (variants.length === 0) {
        throw new Error('AI investigation has no possible outcome: allowDirectResultCreation is false and no resultTools or customErrors were provided.')
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
 * Parses a provider's raw response text into its {@link InvestigationOutcome}, validating it against
 * `outcomeSchema`. The nested `result`/`errorSchema`/`input` payloads are validated against the caller's
 * actual schemas separately, in {@link investigateError}.
 */
export function parseProviderOutcome (content: string, outcomeSchema: JSONSchema): InvestigationOutcome {
    const parsed = parseWithSchema(outcomeSchema, JSON.parse(content), 'investigation outcome') as { outcome: InvestigationOutcome }
    return parsed.outcome
}
