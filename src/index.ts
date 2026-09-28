export { trypatch } from './trypatch'
export { TrypatchFatalError, TrypatchConfigError } from './errors'
export { runInvestigation, investigateError } from './investigation/runInvestigation'
export { Logger } from './logger'
export { buildInvestigationContext } from './investigation/investigationContext'
export { buildInvestigationResultSchema } from './investigation/aiInvestigation/resultSchema'
export type {
    InvestigationErrorOutcome,
    InvestigationExplicitResultOutcome,
    InvestigationOutcome,
    InvestigationResultToolOutcome,
} from './investigation/aiInvestigation/resultSchema'
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
    CustomInvestigationErrorDefinition,
    InvestigationBehavior,
    InvestigationContext,
    InvestigationProviderConfig,
    InvestigationTool,
    ResultTool,
    TryPatchOptions,
} from './types'
export type { VaultOptions } from 'flare-redact'
export type { ClaudeInvestigationConfig } from './investigation/aiInvestigation/providers/claude/types'
export type { CursorInvestigationConfig, CursorRepositoryConfig } from './investigation/aiInvestigation/providers/cursor/types'
export type { OpenAiInvestigationConfig } from './investigation/aiInvestigation/providers/openai/types'
export type { Schema, SchemaInfer } from './schema/types'
export {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './investigation/aiInvestigation/redact/flareRedact'
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
