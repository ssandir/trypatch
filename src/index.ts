export { trypatch } from './trypatch'
export {
    TrypatchFatalError,
    TrypatchConfigError,
    TrypatchCannotDetermineError,
    TrypatchUncertainResultError,
    TrypatchNoApplicableOutcomeError,
    TrypatchTimeoutError,
} from './errors'
export { runInvestigation, investigateError } from './investigation/runInvestigation'
export { Logger } from './logger'
export { buildInvestigationContext } from './investigation/investigationContext'
export { buildInvestigationResultSchema } from './investigation/aiInvestigation/resultSchema'
export type {
    InvestigationCannotDetermineOutcome,
    InvestigationErrorOutcome,
    InvestigationExplicitResultOutcome,
    InvestigationNoApplicableOutcome,
    InvestigationOutcome,
    InvestigationResultToolOutcome,
    InvestigationUncertainOutcome,
} from './investigation/aiInvestigation/resultSchema'
export { defineTool } from './tools'
export type {
    Tool,
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
    InvestigationResultDetails,
    InvestigationTool,
    ResultTool,
    TryPatchOptions,
} from './types'
export type { VaultOptions } from 'flare-redact'
export type { CursorInvestigationConfig, CursorRepositoryConfig } from './investigation/aiInvestigation/providers/cursor/types'
export type {
    ClaudeInvestigationConfig,
    OpenAiCompatibleInvestigationConfig,
    OpenAiInvestigationConfig,
} from './investigation/aiInvestigation/providers/languageModel/types'
export type {
    McpHeaders,
    McpRemoteServerConfig,
    McpServerConfig,
    McpStdioServerConfig,
} from './investigation/aiInvestigation/mcp/types'
export type { Schema, SchemaInfer } from './schema/types'
export {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './investigation/aiInvestigation/redact/flareRedact'
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
