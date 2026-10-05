import { withDeadline } from '../abort/withDeadline'
import { getParser, getSchema, toFunctionToolName } from './schema'
import type {
    Tool,
    ToolDefinition,
    ToolInput,
    ToolInputValue,
} from './types'

export function defineTool<
    TSchema extends ToolInput = undefined,
    Context = unknown,
    Result = unknown,
> (definition: ToolDefinition<TSchema, Context, Result>): Tool<TSchema, Context, Result> {
    // Reject an invalid schema when the tool is defined rather than on its first call.
    getSchema(definition.parameters)

    return { ...definition, name: toFunctionToolName(definition.name) }
}

export async function callTool<TSchema extends ToolInput, Context, Result> (
    tool: Tool<TSchema, Context, Result>,
    input: string,
    context: Context | undefined,
    options: { signal: AbortSignal | undefined },
): Promise<Awaited<Result>> {
    const parse = getParser(tool.parameters, tool.name) as (input: string) => ToolInputValue<TSchema>

    return await withDeadline(async (signal): Promise<Awaited<Result>> => {
        return await tool.execute(parse(input), context, { signal })
    }, {
        signal: options.signal,
        timeout: tool.timeoutMs === undefined ? undefined : { ms: tool.timeoutMs, label: `Tool ${tool.name}` },
    })
}
