import { createJsonSchemaValidator, isZodSchema } from '../../schema/utils'
import type { ResultSchema } from '../../trypatchOptions'

export function parseInvestigationResult (
    schema: ResultSchema | undefined,
    value: unknown,
): unknown {
    if (schema === undefined) {
        return value
    }

    if (isZodSchema(schema)) {
        return schema.parse(value)
    }

    createJsonSchemaValidator(schema, 'investigation result')(value)
    return value
}
