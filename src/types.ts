import type { VaultOptions } from 'flare-redact'
import type { LoggingOptions } from './logger'
import type { Tool, ToolInput } from './tools'
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

export type InvestigationProviderConfig
    = | LanguageModelInvestigationConfig
        | CursorInvestigationConfig

export type InvestigationContext = {
    error: unknown
    methodName: string
    /**
     * The decorated method's code as loaded at runtime (`Function.prototype.toString()`), so compiled
     * and possibly minified rather than the original TypeScript. Decorators applied below `@trypatch`
     * replace the method first, so this is their wrapper's code instead.
     */
    methodSource: string
    args: unknown[]
    methodMetadata: {
        className?: string
        static: boolean
        private: boolean
    }
}

export type InvestigationBehavior = {
    /**
     * Replaces the default user prompt. A function receives the investigation context with `args`
     * already passed through {@link sanitizeArgs}.
     */
    prompt?: string | ((ctx: InvestigationContext) => string)
    systemPrompt?: string
    maxTokens?: number
    /** Transforms the call's arguments before they go into the prompt, default or custom. */
    sanitizeArgs?: (args: unknown[]) => unknown[]
    /**
     * Whether the default prompt includes the method's code ({@link InvestigationContext.methodSource}),
     * so the AI can see what the failed call was meant to do. It is sent to the provider (after
     * `redactConfig`), so leave it off if your code must not leave your infrastructure. Defaults to `false`.
     */
    allowMethodSource?: boolean
    /**
     * Whether the AI may return a `result` directly, versus only via {@link AiInvestigationOptions.resultTools}/{@link AiInvestigationOptions.customErrors}.
     * Defaults to `true`.
     */
    allowDirectResultCreation?: boolean
    /**
     * Whether the AI may report that there isn't enough information to work out a correct return value.
     * Ends the investigation with {@link TrypatchCannotDetermineError}, which is logged; the method then
     * rethrows its original error. Defaults to `true`.
     */
    allowCannotDetermine?: boolean
    /**
     * Whether the AI may report that a plausible return value exists but its confidence in it is too low
     * to return it, instead of guessing. Ends the investigation with {@link TrypatchUncertainResultError},
     * which is logged; the method then rethrows its original error. Defaults to `true`.
     */
    allowUncertainResult?: boolean
    /**
     * Whether the AI may report that none of the configured outcomes actually fit the situation.
     * Ends the investigation with {@link TrypatchNoApplicableOutcomeError}, which is logged; the method
     * then rethrows its original error. Defaults to `true`.
     */
    allowNoApplicableOutcome?: boolean
}

/**
 * Tool the AI may call while investigating. Prefer side-effect-free implementations.
 */
export type InvestigationTool<C = unknown> = Tool<ToolInput, C, unknown>

/**
 * Tool the AI may pick as its outcome; trypatch calls it after the investigation and its return value
 * is returned from the decorated method in place of the error.
 * When {@link TryPatchOptions} includes {@link resultSchema}, execute must return {@link SchemaInfer} for that schema.
 */
export type ResultTool<S extends Schema = Schema, C = unknown>
    = Tool<ToolInput, C, SchemaInfer<S>>

export type CustomErrorDefinition<S extends Schema = Schema> = {
    /** Will be called with a parameter matching the errorParameterSchema. */
    errorConstructor: new (param: SchemaInfer<S>) => Error
    /** Optional description for the AI to understand when to return this error. */
    description?: string
    /** Zod or JSON Schema describing the error constructor parameter type. */
    errorParameterSchema: S
    /**
     * Whether this error propagates out of trypatch. Defaults to `false`: it is logged and the
     * decorated method rethrows its original error instead.
     */
    propagate?: boolean
}

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
    /** Optional prompts, timeouts, token limits, and argument sanitization. */
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
     * Tools the AI may call while investigating. Strongly recommended to be read-only — no mutations or side effects.
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
     * Callback invoked with the value the wrapped method is about to return in place of its error,
     * plus the AI's explanation of why the call failed and why that value is correct.
     */
    onInvestigationResult?: (result: SchemaInfer<S>, details: InvestigationResultDetails) => void | Promise<void>
}

export type InvestigationResultDetails = {
    /** The AI's explanation of why the call failed and why the returned value is correct for it. */
    explanation: string
}

export type CustomInvestigationErrorDefinition = {
    errorConstructor: new (...args: any[]) => Error
}

type CustomInvestigateTryPatchOptions = {
    /**
     * Custom investigation handler; replaces the built-in AI provider flow when provided. Its resolved
     * value is returned from the decorated method in place of the error.
     */
    investigate: (ctx: InvestigationContext, options: { signal?: AbortSignal }) => Promise<unknown>
    /** Error classes that, when thrown by {@link investigate}, propagate instead of the method's original error. */
    customErrors?: CustomInvestigationErrorDefinition[]
}

type TryPatchOptionsBase = {
    logging?: LoggingOptions
    /** Resolves an abort signal from the investigation context (including the call's arguments). Aborts the investigation when the signal fires. */
    getSignal?: (ctx: InvestigationContext) => AbortSignal | undefined
    /** Deadline for the whole investigation, including every tool round. No deadline when unset. */
    timeoutMs?: number
}

export type TryPatchOptions<
    S extends Schema = Schema,
    C = unknown,
> = TryPatchOptionsBase & (
    | { aiInvestigation: AiInvestigationOptions<S, C>, customInvestigation?: never }
    | { customInvestigation: CustomInvestigateTryPatchOptions, aiInvestigation?: never }
)
