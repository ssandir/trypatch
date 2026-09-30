import type { VaultOptions } from 'flare-redact'
import type { LoggingOptions } from './logger'
import type { Tool } from './tools'
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
        static: boolean
        private: boolean
        context: AnyMethodContext
    }
    | {
        dialect: 'legacy'
        name: string | symbol
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
    args: unknown[]
    methodMetadata: {
        className?: string
        static: boolean
        private: boolean
    }
}

export type InvestigationBehavior = {
    prompt?: string | ((ctx: InvestigationContext) => string)
    systemPrompt?: string
    /** Deadline for the whole investigation, including every tool round. */
    timeoutMs?: number
    maxTokens?: number
    // TBD: should not be ignored by cursor
    /** Maximum model turns spent calling {@link AiInvestigationOptions.investigationTools}. Defaults to 20. Ignored by `cursor`. */ 
    maxToolIterations?: number
    sanitizeArgs?: (args: unknown[]) => unknown[]
}

/**
 * Tool the AI may call while investigating. Prefer side-effect-free implementations.
 *
 * `any` on the parameter schema erases {@link Tool}'s invariant `TSchema` generic so heterogeneous
 * `investigationTools` arrays assign without casts.
 */
export type InvestigationTool<C = unknown> = Tool<any, C, unknown>

/**
 * Final-step tool whose return value becomes the investigation result.
 * When {@link TryPatchOptions} includes {@link resultSchema}, execute must return {@link SchemaInfer} for that schema.
 *
 * `any` on the parameter schema erases {@link Tool}'s invariant `TSchema` generic so heterogeneous
 * `resultTools` arrays (different parameter shapes, same {@link SchemaInfer}) assign without casts.
 */
export type ResultTool<S extends Schema = Schema, C = unknown>
    = Tool<any, C, SchemaInfer<S>>

export type CustomErrorDefinition<S extends Schema = Schema> = {
    /** Will be called with a parameter matching the errorParameterSchema. */
    errorConstructor: new (param: SchemaInfer<S>) => Error
    /** Optional description for the AI to understand when to return this error. */
    description?: string
    /** Zod or JSON Schema describing the error constructor parameter type. */
    errorParameterSchema: S
    /** Whether this error propagates out of trypatch instead of being logged and swallowed. Defaults to `false`. */
    propagate?: boolean
}

export type AiInvestigationOptions<
    S extends Schema = Schema,
    C = unknown,
> = {
    /** JSON Schema or Zod schema that structured investigation results must match. */
    resultSchema?: S
    /** External AI provider that runs the investigation. */
    investigationProvider: InvestigationProviderConfig
    /** Optional prompts, timeouts, token limits, and argument sanitization. */
    investigationBehavior?: InvestigationBehavior
    /**
     * Optional flare-redact vault options. When set, investigation prompts are redacted
     * before they are sent to the provider and placeholders are restored in the response.
     */
    redactConfig?: VaultOptions
    /** Context passed to {@link investigationTools} and {@link resultTools} execute handlers. */
    toolContext?: C
    /**
     * Tools the AI may call while investigating. Strongly recommended to be read-only — no mutations or side effects.
     */
    investigationTools?: InvestigationTool<C>[]
    /**
     * MCP servers whose tools the AI may call while investigating, alongside {@link investigationTools}.
     * Connected once per investigation and closed afterwards. A server that can't be reached is logged
     * as a warning and skipped, and the AI is told it's unavailable.
     *
     * Recommended: expose only read-only tools (narrow them with `allowedTools`), since the AI decides what to call.
     */
    mcpServers?: McpServerConfig[]
    /**
     * Tools invoked as the final step once investigation completes.
     * The return value of the invoked result tool is returned directly as the investigation result.
     */
    resultTools?: ResultTool<S, C>[]
    /** Custom error classes the AI can throw during investigation. */
    customErrors?: CustomErrorDefinition[]
    /**
     * Whether the AI may return a `result` directly, versus only via {@link resultTools}/{@link customErrors}.
     * Defaults to `true`.
     */
    allowDirectResultCreation?: boolean
    /**
     * Whether the AI may report that it could not determine any result — there isn't enough
     * information to identify a cause. Throws {@link TrypatchCannotDetermineError}. Defaults to `true`.
     */
    allowCannotDetermine?: boolean
    /**
     * Whether the AI may report a plausible result exists but its confidence in it is too low to
     * state as fact, instead of guessing. Throws {@link TrypatchUncertainResultError}. Defaults to `true`.
     */
    allowUncertainResult?: boolean
    /**
     * Whether the AI may report that none of the configured outcomes actually fit the situation.
     * Throws {@link TrypatchNoApplicableOutcomeError}. Defaults to `true`.
     */
    allowNoApplicableOutcome?: boolean
    /** Callback invoked with the parsed investigation result before it is returned from the wrapped method. */
    onInvestigationResult?: (result: SchemaInfer<S>) => void | Promise<void>
}

export type CustomInvestigationErrorDefinition = {
    errorConstructor: new (...args: any[]) => Error
}

type CustomInvestigateTryPatchOptions = {
    /** Custom investigation handler; replaces the built-in AI provider flow when provided. */
    investigate: (ctx: InvestigationContext) => Promise<unknown>
    /** Error classes that, when thrown by {@link investigate}, propagate instead of being swallowed. */
    customErrors?: CustomInvestigationErrorDefinition[]
}

type TryPatchOptionsBase = {
    logging?: LoggingOptions
}

export type TryPatchOptions<
    S extends Schema = Schema,
    C = unknown,
> = TryPatchOptionsBase & (
    | { aiInvestigation: AiInvestigationOptions<S, C>, customInvestigation?: never }
    | { customInvestigation: CustomInvestigateTryPatchOptions, aiInvestigation?: never }
)
