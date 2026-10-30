import type { ToolSet } from 'ai'
import type { Vault } from 'flare-redact'
import type { Logger } from '../../../../logger'
import type { McpServerConfig } from '../../mcp/types'
import type { InvestigationTool } from '../../../../types'

export type LanguageModelInvestigationOptions<C = unknown> = {
    investigationTools?: InvestigationTool<C>[] | undefined
    toolContext?: C | undefined
    vault?: Vault | undefined
    mcpServers?: McpServerConfig[] | undefined
    logger?: Logger | undefined
    signal?: AbortSignal | undefined
}

export type McpConnection = {
    tools: ToolSet
    close: () => Promise<void>
}
