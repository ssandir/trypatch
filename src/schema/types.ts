import type { JSONSchema } from 'json-schema-to-ts'
import type { $ZodType, output as ZodOutput } from 'zod/v4/core'

/** No schema means no value: a tool without `parameters` takes no input, a custom error without `errorParameterSchema` no parameter. */
export type Schema = JSONSchema | $ZodType | undefined

export type SchemaInfer<S extends Schema>
    = S extends $ZodType ? ZodOutput<S>
        // FromSchema<S> triggers TS2589 (excessively deep instantiation) through our generic types.
        // `any` lets callers annotate the value, e.g. with FromSchema<typeof schema>.
        : S extends JSONSchema ? any
            : undefined
