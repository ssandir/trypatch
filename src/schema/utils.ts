import Ajv, { type AnySchema } from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { JSONSchema } from 'json-schema-to-ts'
import { parse, toJSONSchema } from 'zod/v4/core'
import type { $ZodType } from 'zod/v4/core'
import { TrypatchFatalError } from '../errors'
import type { Schema } from './types'

// Ajv's default logger is the console; its log-only strict checks shouldn't print from inside the library.
const ajv = addFormats(new Ajv({ logger: false }))
const ajv2020 = addFormats(new Ajv2020({ logger: false }))

// The default instance only knows draft-07, and Ajv can't add the 2020-12 meta-schema to it.
function ajvFor (schema: JSONSchema): Ajv {
    return typeof schema === 'object' && schema.$schema?.includes('2020-12') ? ajv2020 : ajv
}

export function isZodSchema (value: unknown): value is $ZodType {
    return typeof value === 'object'
        && value !== null
        && '_zod' in value
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
    const schemaAjv = ajvFor(schema)
    let validate
    try {
        // json-schema-to-ts and Ajv model JSON Schema with different types; compile accepts the runtime object.
        validate = schemaAjv.compile(schema as unknown as AnySchema)
    } catch (error) {
        throw new TrypatchFatalError(`${label} is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Ajv keeps every schema object it compiles and has no option to turn that off; outcome schemas are rebuilt per investigation.
    if (typeof schema === 'object') {
        schemaAjv.removeSchema(schema as AnySchema)
    }

    return (value: unknown) => {
        if (!validate(value)) {
            throw new Error(`Invalid ${label}: ${schemaAjv.errorsText(validate.errors, { separator: '; ' })}`)
        }
    }
}

/** Compiles a JSON Schema so an invalid one throws where it's configured, not during an investigation; Zod schemas are checked by their conversion. */
export function assertValidJsonSchema (schema: Schema, label: string): void {
    if (schema !== undefined && !isZodSchema(schema)) {
        createJsonSchemaValidator(schema, label)
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
