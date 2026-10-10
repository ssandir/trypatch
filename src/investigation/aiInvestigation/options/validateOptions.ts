import type { Schema } from '../../../schema/types'
import { assertValidJsonSchema } from '../../../schema/utils'
import type { AiInvestigationOptions } from '../../../types'
import { validateMcpServers } from '../mcp/servers'
import { buildInvestigationResultSchema, outcomeSchemaOptions } from '../resultSchema'

/** Throws on options that would fail every investigation, so they surface when the decorator is applied rather than after a failure. */
export function validateAiInvestigationOptions<S extends Schema, C> (options: AiInvestigationOptions<S, C>): void {
    validateMcpServers(options.mcpServers, options.investigationProvider.provider)
    // Throws when no outcome is possible or a Zod schema can't be converted; the envelope converts nothing, so it can't fail differently.
    buildInvestigationResultSchema(outcomeSchemaOptions(options))
    // Result tools' parameters are checked by defineTool.
    assertValidJsonSchema(options.resultSchema, 'resultSchema')
    for (const definition of options.customErrors ?? []) {
        assertValidJsonSchema(definition.errorParameterSchema, `customErrors entry ${definition.errorConstructor.name} errorParameterSchema`)
    }
}
