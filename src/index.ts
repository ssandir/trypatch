export { trypatch } from './trypatch'
export { handleError } from './handleError'
export { Logger } from './logger'
export { investigateError, buildInvestigationContext } from './investigation/investigate'
export { resolveApiKey, defaultAuthVariable } from './investigation/resolveApiKey'
export { Tool } from './tools'
export type {
    ToolInput,
    ToolInputValue,
    ToolDefinition,
    ToolHandler,
} from './tools'
export type {
    AiInvestigationOptions,
    ApiKeyAuth,
    CursorInvestigationConfig,
    CursorRepositoryConfig,
    InferResult,
    InvestigationBehavior,
    InvestigationContext,
    InvestigationProviderConfig,
    InvestigationTool,
    OpenAiInvestigationConfig,
    ResultTool,
    ResultSchema,
    VaultOptions,
    TryPatchOptions,
} from './trypatchOptions'
export {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './investigation/redact/flareRedact'
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
