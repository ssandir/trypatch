import type { Schema } from '../../../schema/types'
import type { AiInvestigationOptions } from '../../../types'
import { validateMcpServers } from '../mcp/servers'
import { getOutcomeSchema } from '../resultSchema'

/** Throws on options that would fail every investigation, so they surface when the decorator is applied rather than after a failure. */
export function validateAiInvestigationOptions<S extends Schema, C> (options: AiInvestigationOptions<S, C>): void {
    validateMcpServers(options.mcpServers, options.investigationProvider.provider)
    // Throws when no outcome is possible; the schema it builds is the one every investigation reuses.
    getOutcomeSchema(options)
}
