import type { JSONSchema } from 'json-schema-to-ts'
import type { $ZodType, output as ZodOutput } from 'zod/v4/core'

export type Schema = JSONSchema | $ZodType

export type SchemaInfer<S extends Schema | undefined>
    = S extends $ZodType ? ZodOutput<S>
        // FromSchema<S> triggers TS2589 (excessively deep instantiation) through our generic types.
        // `any` lets callers annotate the value, e.g. with FromSchema<typeof schema>.
        : S extends JSONSchema ? any
            // No schema, e.g. a tool without `parameters` takes no input.
            : undefined
