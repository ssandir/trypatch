import type { JSONSchema } from 'json-schema-to-ts'
import type { $ZodType, output as ZodOutput } from 'zod/v4/core'

export type Schema = JSONSchema | $ZodType

export type SchemaInfer<S extends Schema>
    = S extends $ZodType ? ZodOutput<S>
        // JSON Schema has no runtime type info, so infer as any
        : S extends JSONSchema ? any
            : never
