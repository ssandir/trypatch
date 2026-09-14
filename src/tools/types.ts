import type { JSONSchema } from 'json-schema-to-ts'
import type { ZodObject, output as ZodOutput } from 'zod'

export type ToolInput = undefined | ZodObject | JSONSchema

export type ToolInputValue<TSchema extends ToolInput>
    = TSchema extends ZodObject ? ZodOutput<TSchema>
        // FromSchema<TSchema> triggers TS2589 (excessively deep instantiation) for JSON Schema.
        // Infer the shape locally with FromSchema<typeof schema> and cast inside execute.
        : TSchema extends JSONSchema ? unknown
            : string

export type ToolHandler<
    TSchema extends ToolInput,
    Context = unknown,
    Result = unknown,
> = (
    input: ToolInputValue<TSchema>,
    context?: Context,
) => Result | Promise<Result>

export type ToolDefinition<
    TSchema extends ToolInput = undefined,
    Context = unknown,
    Result = unknown,
> = {
    name: string
    description: string
    parameters?: TSchema
    execute: ToolHandler<TSchema, Context, Result>
    timeoutMs?: number
}
