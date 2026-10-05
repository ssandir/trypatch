import { withDeadline } from '../abort/withDeadline'
import { parseWithSchema } from '../schema/utils'
import { getSchema, toFunctionToolName } from './schema'
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
    input: unknown,
    context: Context | undefined,
    options: { signal: AbortSignal | undefined },
): Promise<Awaited<Result>> {
    // A tool without parameters gets no input, whatever the model sent.
    const parsed = (tool.parameters === undefined
        ? undefined
        : parseWithSchema(tool.parameters, input, `parameters for tool ${tool.name}`)) as ToolInputValue<TSchema>

    return await withDeadline(async (signal): Promise<Awaited<Result>> => {
        return await tool.execute(parsed, context, { signal })
    }, {
        signal: options.signal,
        timeout: tool.timeoutMs === undefined ? undefined : { ms: tool.timeoutMs, label: `Tool ${tool.name}` },
    })
}
