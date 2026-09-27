export { trypatch } from './trypatch'
export { handleError } from './handleError'
export { Logger } from './logger'
export { investigateError } from './investigation/investigate'
export { buildInvestigationContext } from './investigation/investigationContext'
export { buildInvestigationResultSchema } from './investigation/resultSchema'
export type {
    InvestigationErrorOutcome,
    InvestigationExplicitResultOutcome,
    InvestigationOutcome,
    InvestigationResultToolOutcome,
} from './investigation/resultSchema'
export { Providers, type Provider } from './investigation/providers/types'
export { Tool } from './tools'
export type {
    ToolInput,
    ToolInputValue,
    ToolDefinition,
    ToolHandler,
} from './tools'
export type {
    AiInvestigationOptions,
    CustomErrorDefinition,
    InvestigationBehavior,
    InvestigationContext,
    InvestigationProviderConfig,
    InvestigationTool,
    ResultTool,
    TryPatchOptions,
} from './types'
export type { VaultOptions } from 'flare-redact'
export type { ClaudeInvestigationConfig } from './investigation/providers/claude/types'
export type { CursorInvestigationConfig, CursorRepositoryConfig } from './investigation/providers/cursor/types'
export type { OpenAiInvestigationConfig } from './investigation/providers/openai/types'
export type { Schema, SchemaInfer } from './schema/types'
export {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './investigation/redact/flareRedact'
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
