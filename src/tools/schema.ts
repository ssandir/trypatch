import type { JSONSchema } from 'json-schema-to-ts'
import { ZodStandardJSONSchemaPayload } from 'zod/v4/core'
import {
    createJsonSchemaValidator,
    isJsonSchema,
    isZodObject,
    zodToJsonSchemaPayload,
} from '../schema/utils'
import type { ToolInput, ToolInputValue } from './types'

const EMPTY_OBJECT_SCHEMA = {
    type: 'object',
    properties: {},
} as const

function createJsonSchemaParser (
    schema: JSONSchema,
    toolName: string,
): (input: string) => unknown {
    const validate = createJsonSchemaValidator(schema, `parameters for tool ${toolName}`)

    return (input: string) => {
        let parsed: unknown
        try {
            parsed = JSON.parse(input)
        } catch {
            throw new Error(`Invalid JSON input for tool ${toolName}`)
        }

        validate(parsed)
        return parsed
    }
}

export type ToolParametersSchema<TSchema extends ToolInput>
    = TSchema extends JSONSchema
        ? TSchema : TSchema extends undefined
            ? typeof EMPTY_OBJECT_SCHEMA : ZodStandardJSONSchemaPayload<TSchema>

export function toFunctionToolName (name: string): string {
    const normalized = name
        .replace(/\s/g, '_')
        .replace(/[^a-zA-Z0-9]/g, '_')

    if (normalized.length === 0) {
        throw new Error('Tool name cannot be empty')
    }

    return normalized
}

export function getSchema<TSchema extends ToolInput> (
    parameters: TSchema,
): ToolParametersSchema<TSchema> {
    if (parameters === undefined) {
        return { ...EMPTY_OBJECT_SCHEMA } as ToolParametersSchema<TSchema>
    }

    if (isZodObject(parameters)) {
        return zodToJsonSchemaPayload(parameters) as ToolParametersSchema<TSchema>
    }

    if (isJsonSchema(parameters)) {
        return parameters as ToolParametersSchema<TSchema>
    }

    throw new Error('Invalid parameters schema')
}

export function getParser<TSchema extends ToolInput> (
    parameters: TSchema,
    toolName: string,
): (input: string) => ToolInputValue<TSchema> {
    if (parameters === undefined) {
        return ((input: string) => input) as (input: string) => ToolInputValue<TSchema>
    }

    if (isZodObject(parameters)) {
        return ((input: string) => parameters.parse(JSON.parse(input))) as (
            input: string,
        ) => ToolInputValue<TSchema>
    }

    if (isJsonSchema(parameters)) {
        return createJsonSchemaParser(parameters, toolName) as (
            input: string,
        ) => ToolInputValue<TSchema>
    }

    throw new Error(`Invalid parameters for tool ${toolName}`)
}
