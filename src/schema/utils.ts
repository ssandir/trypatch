import { ZodStandardJSONSchemaPayload } from 'zod/v4/core'
import Ajv, { type AnySchema } from 'ajv'
import type { JSONSchema } from 'json-schema-to-ts'
import { toJSONSchema } from 'zod'
import type { ZodObject, ZodType } from 'zod'
import type { Schema } from './types'

const ajv = new Ajv()

export function isZodSchema (value: unknown): value is ZodType {
    return typeof value === 'object'
        && value !== null
        && 'safeParse' in value
        && typeof value.safeParse === 'function'
}

export function isZodObject (value: unknown): value is ZodObject {
    return isZodSchema(value)
        && '_def' in value
        && typeof value._def === 'object'
        && value._def !== null
        && 'type' in value._def
        && value._def.type === 'object'
}

export function isJsonSchema (value: unknown): value is JSONSchema {
    return typeof value === 'object' && value !== null
}

function zodToJsonSchemaRecord (schema: ZodType): JSONSchema {
    const converted = toJSONSchema(schema)
    if ('schema' in converted && converted.schema && typeof converted.schema === 'object') {
        return converted.schema
    }
    return converted as JSONSchema
}

export function zodToJsonSchemaPayload<TSchema extends ZodObject> (
    schema: TSchema,
): ZodStandardJSONSchemaPayload<TSchema> {
    const converted = toJSONSchema(schema)
    if ('schema' in converted && converted.schema && typeof converted.schema === 'object') {
        // Zod < v4 returns a JSONSchema object, so we need to cast it to the correct type
        return converted.schema as ZodStandardJSONSchemaPayload<TSchema>
    }
    return converted
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

export function toJsonSchemaObject (schema: Schema): JSONSchema {
    if (isZodSchema(schema)) {
        return zodToJsonSchemaRecord(schema)
    }

    return schema
}

/** With no schema, `value` is a JSON-encoded string (nothing else could constrain its shape) and gets parsed. */
export function parseWithSchema (
    schema: Schema | undefined,
    value: unknown,
    label = 'value',
): unknown {
    if (schema === undefined) {
        return JSON.parse(value as string)
    }

    if (isZodSchema(schema)) {
        return schema.parse(value)
    }

    createJsonSchemaValidator(schema, label)(value)
    return value
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
