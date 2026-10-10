import { withDeadline } from '../../../abort/withDeadline'
import { TrypatchFatalError } from '../../../errors'
import { assertValidJsonSchema, parseParameter } from '../../../schema/utils'
import { getSchema, toFunctionToolName } from './schema'
import type {
    Tool,
    ToolDefinition,
} from './types'
import type { Schema, SchemaInfer } from '../../../schema/types'

export function defineTool<
    TSchema extends Schema = undefined,
    Context = unknown,
    Result = unknown,
> (definition: ToolDefinition<TSchema, Context, Result>): Tool<TSchema, Context, Result> {
    // Reject an invalid schema when the tool is defined rather than on its first call.
    const schema = getSchema(definition.parameters, `Tool ${definition.name} parameters`)
    // Providers require tool input to be an object schema.
    if (typeof schema !== 'object' || schema.type !== 'object') {
        throw new TrypatchFatalError(`Tool ${definition.name} parameters must be an object schema`)
    }
    assertValidJsonSchema(definition.parameters, `Tool ${definition.name} parameters`)

    return { ...definition, name: toFunctionToolName(definition.name) }
}

export async function callTool<TSchema extends Schema, Context, Result> (
    tool: Tool<TSchema, Context, Result>,
    input: unknown,
    context: Context | undefined,
    options: { signal: AbortSignal | undefined },
): Promise<Awaited<Result>> {
    const parsed = parseParameter(tool.parameters, input, `parameters for tool ${tool.name}`) as SchemaInfer<TSchema>

    return await withDeadline(async (signal): Promise<Awaited<Result>> => {
        return await tool.execute(parsed, context, { signal })
    }, {
        signal: options.signal,
        timeout: tool.timeoutMs === undefined ? undefined : { ms: tool.timeoutMs, label: `Tool ${tool.name}` },
    })
}
