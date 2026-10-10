import Ajv, { type AnySchema } from 'ajv'
import type { JSONSchema } from 'json-schema-to-ts'
import { parse, toJSONSchema } from 'zod/v4/core'
import type { $ZodType } from 'zod/v4/core'
import { TrypatchFatalError } from '../errors'
import type { Schema } from './types'

const ajv = new Ajv()

export function isZodSchema (value: unknown): value is $ZodType {
    return typeof value === 'object'
        && value !== null
        && '_zod' in value
}

export function isJsonSchema (value: unknown): value is JSONSchema {
    return typeof value === 'object' && value !== null
}

function zodToJsonSchemaRecord (schema: $ZodType, label: string): JSONSchema {
    let converted
    try {
        converted = toJSONSchema(schema)
    } catch (error) {
        // Zod throws for types JSON Schema can't express (transforms, dates, bigints); its message doesn't say which option.
        throw new TrypatchFatalError(`${label} can't be converted to JSON Schema: ${error instanceof Error ? error.message : String(error)}`)
    }
    if ('schema' in converted && converted.schema && typeof converted.schema === 'object') {
        return converted.schema
    }
    return converted as JSONSchema
}

export function createJsonSchemaValidator (
    schema: JSONSchema,
    label: string,
): (value: unknown) => void {
    // json-schema-to-ts and Ajv model JSON Schema with different types; compile accepts the runtime object.
    const validate = ajv.compile(schema as unknown as AnySchema)

    return (value: unknown) => {
        if (!validate(value)) {
            throw new Error(`Invalid ${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
        }
    }
}

/** `label` names the option `schema` came from, for the error thrown when it can't be converted. */
export function toJsonSchemaObject (schema: NonNullable<Schema>, label: string): JSONSchema {
    if (isZodSchema(schema)) {
        return zodToJsonSchemaRecord(schema, label)
    }

    return schema
}

/** With no schema, `value` is a JSON-encoded string (nothing else could constrain its shape) and gets parsed. */
export function parseWithSchema (
    schema: Schema,
    value: unknown,
    label = 'value',
): unknown {
    if (schema === undefined) {
        return JSON.parse(value as string)
    }

    if (isZodSchema(schema)) {
        return parse(schema, value)
    }

    createJsonSchemaValidator(schema, label)(value)
    return value
}

export function parseParameter (schema: Schema, value: unknown, label: string): unknown {
    return schema === undefined ? undefined : parseWithSchema(schema, value, label)
}

export function extractJsonFromText (text: string): unknown {
    const trimmed = text.trim()

    try {
        return JSON.parse(trimmed)
    } catch {
        const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
        if (fencedMatch?.[1]) {
            return JSON.parse(fencedMatch[1].trim())
        }

        const objectMatch = trimmed.match(/\{[\s\S]*\}/)
        if (objectMatch?.[0]) {
            return JSON.parse(objectMatch[0])
        }

        throw new SyntaxError('Could not parse investigation result as JSON')
    }
}
