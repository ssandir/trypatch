import type { JSONSchema } from 'json-schema-to-ts'
import type { $ZodObject, output as ZodOutput } from 'zod/v4/core'

export type ToolInput = undefined | $ZodObject | JSONSchema

export type ToolInputValue<TSchema extends ToolInput>
    = TSchema extends $ZodObject ? ZodOutput<TSchema>
        // FromSchema<TSchema> triggers TS2589 (excessively deep instantiation) for JSON Schema.
        // `any` lets execute annotate its input, e.g. with FromSchema<typeof schema>.
        : TSchema extends JSONSchema ? any
            : string

export type ToolHandler<
    TSchema extends ToolInput,
    Context = unknown,
    Result = unknown,
> = (
    input: ToolInputValue<TSchema>,
    context: Context | undefined,
    /** `signal` fires on the tool's own `timeoutMs` or when the investigation is aborted, whichever comes first. */
    options: { signal: AbortSignal },
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

/** A tool created by {@link defineTool}. */
export type Tool<
    TSchema extends ToolInput = ToolInput,
    Context = unknown,
    Result = unknown,
> = {
    readonly name: string
    readonly description: string
    readonly parameters?: TSchema
    readonly timeoutMs?: number
    readonly execute: ToolHandler<TSchema, Context, Result>
}
