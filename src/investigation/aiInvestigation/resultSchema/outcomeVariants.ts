import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { CustomErrorDefinition } from '../../../types'
import type { Schema } from '../../../schema/types'
import { toJsonSchemaObject } from '../../../schema/utils'
import type { LooseTool } from '../toolAdapter'

const explanationProperties = {
    explanation: {
        type: 'string',
        description: 'Why the call failed, and why this outcome gives a correct return value for it.',
    },
} as const satisfies Record<string, JSONSchema>

export function errorOutcomeVariant (definition: CustomErrorDefinition) {
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

export function resultToolOutcomeVariant (tool: LooseTool) {
    return {
        type: 'object',
        description: `Call the "${tool.name}" result tool; its return value is returned from the method in place of the error. Tool description: ${tool.description}`,
        properties: {
            type: { enum: ['resultTool'] },
            ...explanationProperties,
            toolName: { enum: [tool.name] },
            input: tool.parameters,
        },
        required: ['type', 'explanation', 'toolName', 'input'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

export function explicitResultOutcomeVariant (resultSchema: Schema | undefined) {
    return {
        type: 'object',
        description: 'Return this value from the method in place of the error. It must be a correct return value for this call.',
        properties: {
            type: { enum: ['result'] },
            ...explanationProperties,
            result: resultSchema !== undefined
                ? toJsonSchemaObject(resultSchema)
                : {
                    type: 'string',
                    description: 'The method\'s return value, JSON-encoded. It is parsed with JSON.parse and returned in place of the error.',
                },
        },
        required: ['type', 'explanation', 'result'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

export const cannotDetermineOutcomeVariant = {
    type: 'object',
    description: 'There is not enough information to work out a correct return value for this call. Use this instead of fabricating one.',
    properties: {
        type: { enum: ['cannotDetermine'] },
        reason: { type: 'string', description: 'Brief explanation of why no return value could be determined.' },
    },
    required: ['type', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationCannotDetermineOutcome = FromSchema<typeof cannotDetermineOutcomeVariant>

export const uncertainOutcomeVariant = {
    type: 'object',
    description: 'A plausible return value exists, but confidence that it is correct is too low to return it. Use this instead of guessing.',
    properties: {
        type: { enum: ['uncertain'] },
        reason: { type: 'string', description: 'Why a return value cannot be determined with sufficient confidence.' },
    },
    required: ['type', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationUncertainOutcome = FromSchema<typeof uncertainOutcomeVariant>

export const noApplicableOutcomeVariant = {
    type: 'object',
    description: 'None of the other available outcomes (result, result tools, custom errors) actually fit this situation.',
    properties: {
        type: { enum: ['noApplicableOutcome'] },
        reason: { type: 'string', description: 'Why none of the other available outcomes fit.' },
    },
    required: ['type', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationNoApplicableOutcome = FromSchema<typeof noApplicableOutcomeVariant>
