import type { JSONSchema } from 'json-schema-to-ts'
import type { CustomErrorDefinition, Schema, SchemaInfer } from '../trypatchOptions'
import { toJsonSchemaObject } from '../schema/utils'
import type { LooseTool } from './toolAdapter'

export type InvestigationErrorOutcome = {
    type: 'error'
    error: string
    errorSchema: unknown
}

export type InvestigationResultToolOutcome = {
    type: 'resultTool'
    toolName: string
    input: unknown
}

export type InvestigationExplicitResultOutcome<S extends Schema = Schema> = {
    type: 'result'
    result: SchemaInfer<S>
}

/**
 * Discriminated union an investigation provider's structured output must match:
 * a thrown {@link CustomErrorDefinition}, a call into a {@link ResultTool}, or an explicit
 * result matching {@link Schema}. The `error` and `resultTool` branches are only present
 * in {@link buildInvestigationResultSchema}'s output when `customErrors`/`resultTools` are configured.
 */
export type InvestigationOutcome<S extends Schema = Schema>
    = | InvestigationErrorOutcome
        | InvestigationResultToolOutcome
        | InvestigationExplicitResultOutcome<S>

function errorOutcomeVariant (definition: CustomErrorDefinition): JSONSchema {
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
    }
}

function resultToolOutcomeVariant (tool: LooseTool): JSONSchema {
    return {
        type: 'object',
        properties: {
            type: { enum: ['resultTool'] },
            toolName: { enum: [tool.name] },
            input: tool.parameters,
        },
        required: ['type', 'toolName', 'input'],
        additionalProperties: false,
    }
}

function explicitResultOutcomeVariant (resultSchema: Schema | undefined): JSONSchema {
    return {
        type: 'object',
        properties: {
            type: { enum: ['result'] },
            result: resultSchema !== undefined ? toJsonSchemaObject(resultSchema) : {},
        },
        required: ['type', 'result'],
        additionalProperties: false,
    }
}

/**
 * Builds a strict-mode-compatible JSON Schema (per OpenAI's structured outputs rules: object root,
 * `additionalProperties: false` and fully `required` properties throughout, union variants nested
 * under a property rather than at the schema root) describing the {@link InvestigationOutcome}
 * a provider's structured output must produce.
 */
export function buildInvestigationResultSchema (options: {
    resultSchema?: Schema
    customErrors?: CustomErrorDefinition[]
    resultTools?: LooseTool[]
}): JSONSchema {
    const variants = [
        ...(options.customErrors ?? []).map(errorOutcomeVariant),
        ...(options.resultTools ?? []).map(resultToolOutcomeVariant),
        explicitResultOutcomeVariant(options.resultSchema),
    ]

    return {
        type: 'object',
        properties: {
            outcome: { anyOf: variants },
        },
        required: ['outcome'],
        additionalProperties: false,
    }
}
