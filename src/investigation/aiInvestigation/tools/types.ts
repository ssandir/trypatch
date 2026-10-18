import type { Schema, SchemaInfer } from '../../../schema/types'

/**
 * A tool's `execute`: gets its validated input, the `toolContext`, and a signal.
 * @group Tools
 */
export type ToolHandler<
    TSchema extends Schema,
    Context = unknown,
    Result = unknown,
> = (
    input: SchemaInfer<TSchema>,
    context: Context | undefined,
    /** `signal` fires on the tool's own `timeoutMs` or when the investigation is aborted, whichever comes first. */
    options: { signal: AbortSignal },
) => Result | Promise<Result>

/**
 * What you pass to {@link defineTool}.
 * @group Tools
 */
export type ToolDefinition<
    TSchema extends Schema = undefined,
    Context = unknown,
    Result = unknown,
> = {
    /** Shown to the AI, with every character other than letters and digits replaced by `_`. */
    name: string
    /** Tells the AI what the tool does and when to use it. */
    description: string
    /** Schema of `execute`'s input. Omit it for a tool that takes no input: `execute` then receives `undefined`. */
    parameters?: TSchema
    /** Runs the tool; for a result tool, its return value becomes the decorated method's. */
    execute: ToolHandler<TSchema, Context, Result>
    /** Deadline for one call, on top of the investigation's `timeoutMs`; the call fails with {@link TrypatchTimeoutError}. */
    timeoutMs?: number
}

/**
 * A tool created by {@link defineTool}.
 * @group Tools
 */
export type Tool<
    TSchema extends Schema = Schema,
    Context = unknown,
    Result = unknown,
> = {
    /** {@link ToolDefinition.name}, with every character other than letters and digits replaced by `_`. */
    readonly name: string
    /** {@inheritDoc ToolDefinition.description} */
    readonly description: string
    /** {@inheritDoc ToolDefinition.parameters} */
    readonly parameters?: TSchema
    /** {@inheritDoc ToolDefinition.timeoutMs} */
    readonly timeoutMs?: number
    /** {@inheritDoc ToolDefinition.execute} */
    readonly execute: ToolHandler<TSchema, Context, Result>
}
