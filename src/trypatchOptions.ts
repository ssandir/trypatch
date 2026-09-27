import type { VaultOptions } from 'flare-redact'
import type { LoggingOptions } from './logger'
import type { Tool } from './tools'
import type { ClaudeInvestigationConfig } from './investigation/providers/claude/types'
import type { CursorInvestigationConfig } from './investigation/providers/cursor/types'
import type { OpenAiInvestigationConfig } from './investigation/providers/openai/types'
import type { Schema, SchemaInfer } from './schema/types'

export type InvestigationProviderConfig
    = | OpenAiInvestigationConfig
        | CursorInvestigationConfig
        | ClaudeInvestigationConfig

export type InvestigationContext = {
    error: unknown
    methodName: string
    className?: string
    args: unknown[]
    sanitizedArgs: unknown[]
}

export type InvestigationBehavior = {
    prompt?: string | ((ctx: InvestigationContext) => string)
    systemPrompt?: string
    timeoutMs?: number
    maxTokens?: number
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

type TryPatchOptionsBase = {
    logging?: LoggingOptions
}

export type CustomErrorDefinition<S extends Schema = Schema> = {
    /** Will be called with a parameter matching the errorParameterSchema. */
    errorConstructor: new (param: SchemaInfer<S>) => Error
    /** Optional description for the AI to understand when to return this error. */
    description?: string
    /** Zod or JSON Schema describing the error constructor parameter type. */
    errorParameterSchema: S
}

export type AiInvestigationOptions<
    S extends Schema = Schema,
    C = unknown,
> = TryPatchOptionsBase & {
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
     * Tools invoked as the final step once investigation completes.
     * The return value of the invoked result tool is returned directly as the investigation result.
     */
    resultTools?: ResultTool<S, C>[]
    /** Custom error classes the AI can throw during investigation. */
    customErrors?: CustomErrorDefinition[]
    /** Callback invoked with the parsed investigation result before it is returned from the wrapped method. */
    onInvestigationResult?: (result: SchemaInfer<S>) => void | Promise<void>
}

type CustomInvestigateTryPatchOptions = TryPatchOptionsBase & {
    /** Custom investigation handler; replaces the built-in AI provider flow when provided. */
    investigate: (ctx: InvestigationContext) => Promise<unknown>
}

export type TryPatchOptions<
    S extends Schema = Schema,
    C = unknown,
> =
    | { aiInvestigation: AiInvestigationOptions<S, C>, customInvestigation?: never }
    | { customInvestigation: CustomInvestigateTryPatchOptions, aiInvestigation?: never }
