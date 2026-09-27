export { trypatch } from './trypatch'
export { handleError } from './handleError'
export { Logger } from './logger'
export { investigateError, buildInvestigationContext } from './investigation/investigate'
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
    ClaudeInvestigationConfig,
    CustomErrorDefinition,
    CursorInvestigationConfig,
    CursorRepositoryConfig,
    InvestigationBehavior,
    InvestigationContext,
    InvestigationProviderConfig,
    InvestigationTool,
    OpenAiInvestigationConfig,
    ResultTool,
    Schema,
    SchemaInfer,
    VaultOptions,
    TryPatchOptions,
} from './trypatchOptions'
export {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './investigation/redact/flareRedact'
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
