import type { Tool } from '../../tools'

/**
 * Loosened {@link Tool} for provider adapters — `any` on schema and context sidesteps
 * invariant generics so we avoid defining generic overloads for provider adapters,
 * including mixed arrays. Only `name`, `description`, and `parameters` are read.
 */
export type LooseTool = Tool<any, any, unknown>

export function findToolByName<T extends LooseTool> (
    tools: T[] | undefined,
    name: string,
): T | undefined {
    return tools?.find(tool => tool.name === name)
}
