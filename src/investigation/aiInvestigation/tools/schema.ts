import type { JSONSchema } from 'json-schema-to-ts'
import { TrypatchFatalError } from '../../../errors'
import { toJsonSchemaObject } from '../../../schema/utils'
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

/** A tool's or custom error's input as JSON Schema; with no schema there's no input, shown to the model as an empty object. */
export function toInputJsonSchema (parameters: Schema, label: string): JSONSchema {
    return parameters === undefined ? { ...EMPTY_OBJECT_SCHEMA } : toJsonSchemaObject(parameters, label)
}
