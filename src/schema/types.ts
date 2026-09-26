import type { JSONSchema } from 'json-schema-to-ts'
import type { output as ZodOutput, ZodType } from 'zod'

export type Schema = JSONSchema | ZodType

export type SchemaInfer<S extends Schema>
    = S extends ZodType ? ZodOutput<S>
        // JSON Schema has no runtime type info, so infer as any
        : S extends JSONSchema ? any
            : never
