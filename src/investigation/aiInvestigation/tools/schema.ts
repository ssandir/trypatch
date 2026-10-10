import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchFatalError } from '../../../errors'
import { isJsonSchema, toJsonSchemaObject } from '../../../schema/utils'
import type { Schema } from '../../../schema/types'

const EMPTY_OBJECT_SCHEMA = {
    type: 'object',
    properties: {},
} as const

export function toFunctionToolName (name: string): string {
    const normalized = name
        .replace(/\s/g, '_')
        .replace(/[^a-zA-Z0-9]/g, '_')

    if (normalized.length === 0) {
        throw new TrypatchFatalError('Tool name cannot be empty')
    }

    return normalized
}

export function getSchema (parameters: Schema): JSONSchema {
    if (parameters === undefined) {
        return { ...EMPTY_OBJECT_SCHEMA }
    }

    if (isJsonSchema(parameters)) {
        return toJsonSchemaObject(parameters)
    }

    throw new TrypatchFatalError('Invalid parameters schema')
}
