import type { LooseTool } from '../../toolAdapter'

export type OpenAiFunctionToolDefinition = {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

export function toolToOpenAiDefinition (
    tool: LooseTool,
): OpenAiFunctionToolDefinition {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as Record<string, unknown>,
        },
    }
}

export function toolsToOpenAiDefinitions (
    tools: LooseTool[] | undefined,
): OpenAiFunctionToolDefinition[] | undefined {
    if (tools === undefined || tools.length === 0) {
        return undefined
    }

    return tools.map(toolToOpenAiDefinition)
}
