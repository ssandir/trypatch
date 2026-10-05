import type { JSONSchema } from 'json-schema-to-ts'
import { parse } from 'zod/v4/core'
import { TrypatchFatalError } from '../errors'
import {
    createJsonSchemaValidator,
    isJsonSchema,
    isZodObject,
    toJsonSchemaObject,
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

export function toFunctionToolName (name: string): string {
    const normalized = name
        .replace(/\s/g, '_')
        .replace(/[^a-zA-Z0-9]/g, '_')

    if (normalized.length === 0) {
        throw new TrypatchFatalError('Tool name cannot be empty')
    }

    return normalized
}

export function getSchema (parameters: ToolInput): JSONSchema {
    if (parameters === undefined) {
        return { ...EMPTY_OBJECT_SCHEMA }
    }

    if (isZodObject(parameters) || isJsonSchema(parameters)) {
        return toJsonSchemaObject(parameters)
    }

    throw new TrypatchFatalError('Invalid parameters schema')
}

export function getParser<TSchema extends ToolInput> (
    parameters: TSchema,
    toolName: string,
): (input: string) => ToolInputValue<TSchema> {
    if (parameters === undefined) {
        return ((input: string) => input) as (input: string) => ToolInputValue<TSchema>
    }

    if (isZodObject(parameters)) {
        return ((input: string) => parse(parameters, JSON.parse(input))) as (
            input: string,
        ) => ToolInputValue<TSchema>
    }

    if (isJsonSchema(parameters)) {
        return createJsonSchemaParser(parameters, toolName) as (
            input: string,
        ) => ToolInputValue<TSchema>
    }

    throw new TrypatchFatalError(`Invalid parameters for tool ${toolName}`)
}
