import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { CustomErrorDefinition } from '../../../types'
import type { Schema } from '../../../schema/types'
import { toJsonSchemaObject } from '../../../schema/utils'
import type { LooseTool } from '../toolAdapter'

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
        properties: {
            type: { enum: ['resultTool'] },
            toolName: { enum: [tool.name] },
            input: tool.parameters,
        },
        required: ['type', 'toolName', 'input'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

export function explicitResultOutcomeVariant (resultSchema: Schema | undefined) {
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

export const cannotDetermineOutcomeVariant = {
    type: 'object',
    description: 'The investigation genuinely could not determine what happened — there is not enough information to identify a cause or produce a meaningful result. Use this instead of fabricating one.',
    properties: {
        type: { enum: ['cannotDetermine'] },
        reason: { type: 'string', description: 'Brief explanation of why no result could be determined.' },
    },
    required: ['type', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationCannotDetermineOutcome = FromSchema<typeof cannotDetermineOutcomeVariant>

export const uncertainOutcomeVariant = {
    type: 'object',
    description: 'A plausible result exists, but confidence in it is too low to state as fact. Use this instead of guessing.',
    properties: {
        type: { enum: ['uncertain'] },
        reason: { type: 'string', description: 'The plausible result considered, and why confidence in it was too low to return.' },
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
