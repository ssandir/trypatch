export { trypatch } from './trypatch'
export {
    TrypatchFatalError,
    TrypatchConfigError,
    TrypatchCannotDetermineError,
    TrypatchUncertainResultError,
    TrypatchNoApplicableOutcomeError,
    TrypatchTimeoutError,
} from './errors'
export { defineTool } from './investigation/aiInvestigation/tools'
export type {
    Tool,
    ToolDefinition,
    ToolHandler,
    ToolParameters,
} from './investigation/aiInvestigation/tools'
export type {
    AiInvestigationOptions,
    CallTiming,
    CustomErrorDefinition,
    CustomInvestigationErrorDefinition,
    CustomInvestigationOptions,
    InvestigationBehavior,
    InvestigationContext,
    InvestigationProviderConfig,
    InvestigationTool,
    LegacyMethodDecorator,
    ResolvedOutcome,
    ResultTool,
    Stage3MethodDecorator,
    TrypatchOptions,
    TrypatchOptionsBase,
} from './types'
/**
 * [flare-redact](https://www.npmjs.com/package/flare-redact) options for {@link AiInvestigationOptions.redactConfig}.
 * @group Options
 */
export type { VaultOptions } from 'flare-redact'
export type { CursorInvestigationConfig, CursorRepositoryConfig } from './investigation/aiInvestigation/providers/cursor/types'
export type {
    ClaudeInvestigationConfig,
    LanguageModelInvestigationConfig,
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
export type { LoggerLike, LoggingOptions, LoggingVerbosity } from './logger'
