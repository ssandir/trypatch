import type { VaultOptions } from 'flare-redact'
import type { LoggingOptions } from './logger'
import type { Tool } from './investigation/aiInvestigation/tools'
import type { CursorInvestigationConfig } from './investigation/aiInvestigation/providers/cursor/types'
import type { LanguageModelInvestigationConfig } from './investigation/aiInvestigation/providers/languageModel/types'
import type { McpServerConfig } from './investigation/aiInvestigation/mcp/types'
import type { Schema, SchemaInfer } from './schema/types'

export type AnyMethod = (this: unknown, ...args: unknown[]) => unknown
export type AnyMethodContext = ClassMethodDecoratorContext<unknown, AnyMethod>

/**
 * What trypatch knows about the decorated member, sourced honestly per decorator dialect rather
 * than coerced into one pretend-universal shape. `name`/`static`/`private` are real for both
 * dialects; the dialect-specific fields (`context` vs. `target`/`descriptor`) are kept around
 * for anything else worth extracting later (e.g. legacy's `descriptor` still carries
 * `enumerable`/`configurable`/`writable`).
 */
export type MethodDescriptor =
    | {
        dialect: 'stage3'
        name: string | symbol
        method: AnyMethod
        static: boolean
        private: boolean
        context: AnyMethodContext
    }
    | {
        dialect: 'legacy'
        name: string | symbol
        method: AnyMethod
        static: boolean
        /** Legacy decorators cannot be applied to true `#private` methods, so this is always false. */
        private: false
        target: object
        descriptor: PropertyDescriptor
    }

/**
 * Provider config, picked by its `provider` field.
 * @group Providers
 */
export type InvestigationProviderConfig
    = | LanguageModelInvestigationConfig
        | CursorInvestigationConfig

/**
 * The failed call, as passed to callbacks, custom prompts, `getSignal` and `investigate`.
 * @group Types
 */
export type InvestigationContext = {
    /** What the decorated method threw or rejected with. */
    error: unknown
    /** The method's name; `String(symbol)` for a symbol-named method. */
    methodName: string
    /**
     * The decorated method's code as loaded at runtime (`Function.prototype.toString()`), so compiled
     * and possibly minified rather than the original TypeScript. Decorators applied below `@trypatch`
     * replace the method first, so this is their wrapper's code instead.
     */
    methodSource: string
    /** The call's raw arguments, except in a custom {@link InvestigationBehavior.prompt}, which gets them after `sanitizeArgs`. */
    args: unknown[]
    /** Where the method is defined and how. */
    methodMetadata: {
        /** Name of the class (or the instance's class) the method was called on, when it has one. */
        className?: string
        /** Whether it's a static method. */
        static: boolean
        /** Whether it's a `#private` method; always `false` with legacy decorators. */
        private: boolean
    }
    /** When the failed call started and how long it ran before failing. */
    timing: CallTiming
}

/**
 * When the failed call started and how long it ran before failing.
 * @group Types
 */
export type CallTiming = {
    /** When the decorated method was called. */
    startedAt: Date
    /** Milliseconds from the call to its failure, measured with a monotonic clock. */
    durationMs: number
}

/**
 * Prompts, argument sanitization, and which built-in tools and outcomes the AI may use.
 * @group Options
 */
export type InvestigationBehavior = {
    /**
     * Replaces the default user prompt. A function receives the investigation context with `args`
     * already passed through {@link sanitizeArgs}.
     */
    prompt?: string | ((ctx: InvestigationContext) => string)
    /** Replaces the default system prompt. */
    systemPrompt?: string
    /** Transforms the call's arguments before they go into the prompt, default or custom. */
    sanitizeArgs?: (args: unknown[]) => unknown[]
    /**
     * Whether the default prompt includes the method's code ({@link InvestigationContext.methodSource}),
     * so the AI can see what the failed call was meant to do. It is sent to the provider (after
     * `redactConfig`), so leave it off if your code must not leave your infrastructure.
     * @defaultValue `false`
     */
    allowMethodSource?: boolean
    /**
     * Whether the AI may also call the tools in trypatch's built-in safe toolbox (waiting, reading truncated parts of the failed call, encoding/decoding) alongside
     * {@link AiInvestigationOptions.investigationTools}.
     * @defaultValue `true`
     */
    allowSafeToolbox?: boolean
    /**
     * Whether the AI may return a `result` directly, versus only via {@link AiInvestigationOptions.resultTools}/{@link AiInvestigationOptions.customErrors}.
     * @defaultValue `true`
     */
    allowDirectResultCreation?: boolean
    /**
     * Whether the AI may report that there isn't enough information to work out a correct return value.
     * Ends the investigation with {@link TrypatchCannotDetermineError}, which is logged; the method then
     * rethrows its original error.
     * @defaultValue `true`
     */
    allowCannotDetermine?: boolean
    /**
     * Whether the AI may report that a plausible return value exists but its confidence in it is too low
     * to return it, instead of guessing. Ends the investigation with {@link TrypatchUncertainResultError},
     * which is logged; the method then rethrows its original error.
     * @defaultValue `true`
     */
    allowUncertainResult?: boolean
    /**
     * Whether the AI may report that none of the configured outcomes actually fit the situation.
     * Ends the investigation with {@link TrypatchNoApplicableOutcomeError}, which is logged; the method
     * then rethrows its original error.
     * @defaultValue `true`
     */
    allowNoApplicableOutcome?: boolean
}

/**
 * Tool the AI may call while investigating. Prefer side-effect-free implementations.
 * @group Tools
 */
export type InvestigationTool<C = unknown> = Tool<Schema, C, unknown>

/**
 * Tool the AI may pick as its outcome; trypatch calls it after the investigation and its return value
 * is returned from the decorated method in place of the error.
 * When {@link AiInvestigationOptions.resultSchema} is set, execute must return {@link SchemaInfer} for that schema.
 * @group Tools
 */
export type ResultTool<S extends Schema = Schema, C = unknown> = Tool<Schema, C, SchemaInfer<S>>

/**
 * An error the AI may pick as its outcome, constructed from a parameter it supplies.
 * @group Options
 */
export type CustomErrorDefinition<S extends Schema = Schema> = {
    /** Will be called with a parameter matching the errorParameterSchema. */
    errorConstructor: new (param: SchemaInfer<S>) => Error
    /** Optional description for the AI to understand when to return this error. */
    description?: string
    /** Zod or JSON Schema describing the error constructor parameter type. Omit it for an error constructed without one. */
    errorParameterSchema?: S
    /**
     * Whether this error propagates out of trypatch. When `false`, it is logged and the decorated
     * method rethrows its original error instead.
     * @defaultValue `false`
     */
    propagate?: boolean
}

/**
 * Options for investigating a failure with an AI provider.
 * @group Options
 */
export type AiInvestigationOptions<
    S extends Schema = Schema,
    C = unknown,
> = {
    /**
     * JSON Schema or Zod schema of the decorated method's return value. A recovered value (a direct
     * `result` or a {@link resultTools} return value) is returned in place of the error, so it must
     * match what the method returns.
     */
    resultSchema?: S
    /** External AI provider that runs the investigation. */
    investigationProvider: InvestigationProviderConfig
    /** Prompts, argument sanitization, and which built-in tools and outcomes the AI may use. */
    investigationBehavior?: InvestigationBehavior
    /**
     * flare-redact vault options. Investigation prompts and tool output are always redacted reversibly
     * before they reach the provider (flare-redact's default detectors: API keys, tokens, emails, card
     * numbers, …), and placeholders are restored in the response and in tool input. Use this to add
     * `terms` or tune detectors, or set it to `false` to send everything unredacted.
     */
    redactConfig?: VaultOptions | false
    /** Context passed to {@link investigationTools} and {@link resultTools} execute handlers. */
    toolContext?: C
    /**
     * Tools the AI may call while investigating. Strongly recommended to be read-only — no mutations or side effects; ignored by `cursor`.
     */
    investigationTools?: InvestigationTool<C>[]
    /**
     * MCP servers whose tools the AI may call while investigating, alongside {@link investigationTools}.
     * Connected once per investigation and closed afterwards. A server that can't be reached is logged
     * as a warning and skipped.
     *
     * Recommended: expose only read-only tools (narrow them with `allowedTools`), since the AI decides what to call.
     */
    mcpServers?: McpServerConfig[]
    /**
     * Tools the AI may pick as its outcome. trypatch calls the picked tool once the investigation
     * completes, and its return value is returned from the decorated method in place of the error.
     */
    resultTools?: ResultTool<S, C>[]
    /** Custom error classes the AI can throw during investigation. */
    customErrors?: CustomErrorDefinition[]
    /**
     * Called with the AI's outcome before the decorated method returns or rejects, but not when the investigation fails
     * before the AI picks an outcome. If it throws, the decorated method rejects with its original error.
     */
    onAiInvestigationEnd?: (ctx: InvestigationContext, outcome: ResolvedOutcome<SchemaInfer<S>>) => void | Promise<void>
}

/**
 * The AI's findings: its `explanation` of why the call failed and why its outcome is correct, with either the
 * `result` the decorated method returns or the `error` the outcome ended with.
 * @group Types
 */
export type ResolvedOutcome<T = unknown>
    = | {
        type: 'result'
        /** The value the decorated method returns. */
        result: T
        /** Why the call failed and why this value is correct; redaction placeholders are restored. */
        explanation: string
    }
    | {
        type: 'error'
        /** The custom or fallback error the AI picked, or what failed while applying its outcome. */
        error: Error
        /** Why the call failed and why the AI picked this outcome; redaction placeholders are restored. */
        explanation: string
    }

/**
 * An error class that {@link CustomInvestigationOptions.investigate} may throw to replace the method's original error.
 * @group Options
 */
export type CustomInvestigationErrorDefinition = {
    /** Matched with `instanceof` against what `investigate` throws. */
    errorConstructor: new (...args: any[]) => Error
}

/**
 * Options for investigating a failure with your own handler instead of an AI provider.
 * @group Options
 */
export type CustomInvestigationOptions = {
    /**
     * Custom investigation handler; replaces the built-in AI provider flow when provided. Its resolved
     * value is returned from the decorated method in place of the error.
     */
    investigate: (ctx: InvestigationContext, options: { signal?: AbortSignal }) => Promise<unknown>
    /** Error classes that, when thrown by {@link investigate}, propagate instead of the method's original error. */
    customErrors?: CustomInvestigationErrorDefinition[]
}

/**
 * Options shared by AI and custom investigations.
 * @group Options
 */
export type TrypatchOptionsBase = {
    /** Where trypatch logs and how much; nothing is logged without a `logger`. */
    logging?: LoggingOptions
    /**
     * Resolves an abort signal from the investigation context (including the call's arguments), once per call. When it
     * fires, the investigation stops and the decorated method rejects with the signal's `reason`.
     */
    getSignal?: (ctx: InvestigationContext) => AbortSignal | undefined
    /**
     * Deadline for the whole investigation: tool rounds, MCP connections, the picked result tool and `onAiInvestigationEnd`.
     * When it passes, the failure is logged and the method rethrows its original error; no deadline when unset.
     */
    timeoutMs?: number
    /**
     * Called before the investigation starts, e.g. to report `ctx.error`. If it throws, the investigation is skipped
     * and the decorated method rejects with its original error.
     */
    onInvestigationStart?: (ctx: InvestigationContext) => void | Promise<void>
}

/**
 * Options for {@link trypatch}: the shared options plus exactly one of `aiInvestigation` or `customInvestigation`.
 * @group Options
 */
export type TrypatchOptions<
    S extends Schema = Schema,
    C = unknown,
> = TrypatchOptionsBase & (
    | {
        /** Investigate with an AI provider. */
        aiInvestigation: AiInvestigationOptions<S, C>
        /** Not allowed together with `aiInvestigation`. */
        customInvestigation?: never
    }
    | {
        /** Investigate with your own handler. */
        customInvestigation: CustomInvestigationOptions
        /** Not allowed together with `customInvestigation`. */
        aiInvestigation?: never
    }
)

/**
 * The shape {@link trypatch} returns under TypeScript's `experimentalDecorators`.
 * @group Decorator
 */
export type LegacyMethodDecorator = (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
) => PropertyDescriptor | void

/**
 * The shape {@link trypatch} returns under stage-3 decorators; it requires the method to return `Promise` of the `resultSchema` type.
 * @group Decorator
 */
export type Stage3MethodDecorator<S extends Schema> = <
    This,
    Args extends unknown[],
    Return extends Promise<SchemaInfer<S>>,
> (
    originalMethod: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => (this: This, ...args: Args) => Return
