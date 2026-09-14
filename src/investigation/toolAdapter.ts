import type { Tool } from '../tools'

export type OpenAiFunctionToolDefinition = {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

/**
 * Loosened {@link Tool} for provider adapters — `any` on schema and context sidesteps
 * invariant generics so we avoid defining generic overloads for provider adapters,
 * including mixed arrays. Only `name`, `description`, and `parameters` are read.
 */
export type LooseTool = Tool<any, any, unknown>

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

export function findToolByName<T extends LooseTool> (
    tools: T[] | undefined,
    name: string,
): T | undefined {
    return tools?.find(tool => tool.name === name)
}
