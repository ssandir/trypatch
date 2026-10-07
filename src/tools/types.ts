import type { Schema, SchemaInfer } from '../schema/types'

export type ToolInput = Schema | undefined

export type ToolHandler<
    TSchema extends ToolInput,
    Context = unknown,
    Result = unknown,
> = (
    input: SchemaInfer<TSchema>,
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
    /** Schema of `execute`'s input. Omit it for a tool that takes no input: `execute` then receives `undefined`. */
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
