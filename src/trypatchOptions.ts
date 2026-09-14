import type { JSONSchema } from 'json-schema-to-ts'
import type { VaultOptions } from 'flare-redact'
import type { output as ZodOutput, ZodType } from 'zod'
import type { LoggingOptions } from './logger'
import type { Tool } from './tools'

export type { VaultOptions } from 'flare-redact'

export type ResultSchema = JSONSchema | ZodType

export type InferResult<S extends ResultSchema>
    = S extends ZodType ? ZodOutput<S>
        // FromSchema<S> triggers TS2589 for JSON Schema — infer locally with FromSchema<typeof schema>.
        : S extends JSONSchema ? unknown
            : never

export type ApiKeyAuth
    = | { kind: 'inline', apiKey: string }
        | { kind: 'env', variable: string }
        | { kind: 'custom', resolve: () => string | Promise<string> }

export type OpenAiInvestigationConfig = {
    provider: 'openai'
    auth: ApiKeyAuth
    model?: string
    baseURL?: string
    organization?: string
    project?: string
}

export type CursorRepositoryConfig = {
    url: string
    startingRef?: string
    prUrl?: string
}

export type CursorInvestigationConfig = {
    provider: 'cursor'
    auth: ApiKeyAuth
    baseURL?: string
    model?: string | { id: string, params?: { id: string, value: string | boolean | number }[] }
    repository?: CursorRepositoryConfig
    pollIntervalMs?: number
}

export type InvestigationProviderConfig
    = | OpenAiInvestigationConfig
        | CursorInvestigationConfig

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
 * When {@link TryPatchOptions} includes {@link resultSchema}, execute must return {@link InferResult} for that schema.
 *
 * `any` on the parameter schema erases {@link Tool}'s invariant `TSchema` generic so heterogeneous
 * `resultTools` arrays (different parameter shapes, same {@link InferResult}) assign without casts.
 */
export type ResultTool<S extends ResultSchema = ResultSchema, C = unknown>
    = Tool<any, C, InferResult<S>>

type TryPatchOptionsBase = {
    logging?: LoggingOptions
}

export type AiInvestigationOptions<
    S extends ResultSchema = ResultSchema,
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
    /** Callback invoked with the parsed investigation result before it is returned from the wrapped method. */
    onInvestigationResult?: (result: InferResult<S>) => void | Promise<void>
    investigate?: never
}

type CustomInvestigateTryPatchOptions = TryPatchOptionsBase & {
    /** Custom investigation handler; replaces the built-in AI provider flow when provided. */
    investigate: (ctx: InvestigationContext) => Promise<unknown>
    resultSchema?: never
    investigationProvider?: never
    investigationBehavior?: never
    redactConfig?: never
    toolContext?: never
    investigationTools?: never
    resultTools?: never
    onInvestigationResult?: never
}

export type TryPatchOptions<
    S extends ResultSchema = ResultSchema,
    C = unknown,
> = CustomInvestigateTryPatchOptions | AiInvestigationOptions<S, C>
