import type { LooseTool } from '../../toolAdapter'

export type ClaudeToolDefinition = {
    name: string
    description: string
    input_schema: Record<string, unknown>
}

export function toolsToClaudeDefinitions (
    tools: LooseTool[] | undefined,
): ClaudeToolDefinition[] | undefined {
    if (tools === undefined || tools.length === 0) {
        return undefined
    }

    return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Record<string, unknown>,
    }))
}
