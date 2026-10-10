import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import type { CustomErrorDefinition, ResultTool } from '../../../types'
import type { Schema } from '../../../schema/types'
import { toJsonSchemaObject } from '../../../schema/utils'
import { toInputJsonSchema } from '../tools/schema'

function explanationProperties<WhyThisOutcome extends string> (whyThisOutcome: WhyThisOutcome) {
    return {
        explanation: { type: 'string', description: `Why the call failed, and ${whyThisOutcome}` },
    } as const satisfies Record<string, JSONSchema>
}

const valueExplanationProperties = explanationProperties('why this outcome gives a correct return value for it.')

export function errorOutcomeVariant (definition: CustomErrorDefinition) {
    return {
        type: 'object',
        ...definition.description !== undefined ? { description: definition.description } : {},
        properties: {
            type: { enum: ['error'] },
            ...explanationProperties('why this error is the right outcome for it.'),
            error: { enum: [definition.errorConstructor.name] },
            errorSchema: toInputJsonSchema(definition.errorParameterSchema, `customErrors entry ${definition.errorConstructor.name} errorParameterSchema`),
        },
        required: ['type', 'explanation', 'error', 'errorSchema'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

export function resultToolOutcomeVariant<C> (tool: ResultTool<Schema, C>) {
    return {
        type: 'object',
        description: `Call the "${tool.name}" result tool; its return value is returned from the method in place of the error. Tool description: ${tool.description}`,
        properties: {
            type: { enum: ['resultTool'] },
            ...valueExplanationProperties,
            toolName: { enum: [tool.name] },
            input: toInputJsonSchema(tool.parameters, `Result tool ${tool.name} parameters`),
        },
        required: ['type', 'explanation', 'toolName', 'input'],
        additionalProperties: false,
    } as const satisfies JSONSchema
}

export function explicitResultOutcomeVariant (resultSchema: Schema) {
    return {
        type: 'object',
        description: 'Return this value from the method in place of the error. It must be a correct return value for this call.',
        properties: {
            type: { enum: ['result'] },
            ...valueExplanationProperties,
            result: resultSchema !== undefined
                ? toJsonSchemaObject(resultSchema, 'resultSchema')
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
        ...explanationProperties('what is missing to work out a correct return value.'),
        reason: { type: 'string', description: 'Short summary of why no return value could be determined.' },
    },
    required: ['type', 'explanation', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationCannotDetermineOutcome = FromSchema<typeof cannotDetermineOutcomeVariant>

export const uncertainOutcomeVariant = {
    type: 'object',
    description: 'A plausible return value exists, but confidence that it is correct is too low to return it. Use this instead of guessing.',
    properties: {
        type: { enum: ['uncertain'] },
        ...explanationProperties('what the candidate return value is and why confidence in it is too low.'),
        reason: { type: 'string', description: 'Short summary of why a return value cannot be determined with sufficient confidence.' },
    },
    required: ['type', 'explanation', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationUncertainOutcome = FromSchema<typeof uncertainOutcomeVariant>

export const noApplicableOutcomeVariant = {
    type: 'object',
    description: 'None of the other available outcomes (result, result tools, custom errors) actually fit this situation.',
    properties: {
        type: { enum: ['noApplicableOutcome'] },
        ...explanationProperties('why none of the other available outcomes fit it.'),
        reason: { type: 'string', description: 'Short summary of why none of the other available outcomes fit.' },
    },
    required: ['type', 'explanation', 'reason'],
    additionalProperties: false,
} as const satisfies JSONSchema
export type InvestigationNoApplicableOutcome = FromSchema<typeof noApplicableOutcomeVariant>
