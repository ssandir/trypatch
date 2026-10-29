import type { JSONSchema } from 'json-schema-to-ts'
import type { $ZodObject } from 'zod/v4/core'
import type { SchemaInfer } from '../../../schema/types'

/**
 * A tool's input schema: a Zod object or a JSON Schema with `type: 'object'`, since providers require object input.
 * Omit it for a tool that takes no input.
 * @group Tools
 */
export type ToolParameters = $ZodObject | (Exclude<JSONSchema, boolean> & { readonly type: 'object' }) | undefined

/**
 * A tool's `execute`: gets its validated input, the `toolContext`, and a signal.
 * @group Tools
 */
export type ToolHandler<
    TSchema extends ToolParameters,
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
    TSchema extends ToolParameters = undefined,
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
 * A tool for `investigationTools` or `resultTools`, usually created by {@link defineTool}.
 * @group Tools
 */
export type Tool<
    TSchema extends ToolParameters = ToolParameters,
    Context = unknown,
    Result = unknown,
> = Readonly<ToolDefinition<TSchema, Context, Result>>
