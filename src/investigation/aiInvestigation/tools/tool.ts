import { withDeadline } from '../../../abort/withDeadline'
import { TrypatchFatalError } from '../../../errors'
import { assertValidJsonSchema, parseParameter } from '../../../schema/utils'
import { toInputJsonSchema, toFunctionToolName } from './schema'
import type {
    Tool,
    ToolDefinition,
    ToolParameters,
} from './types'
import type { SchemaInfer } from '../../../schema/types'

/**
 * Creates a tool for `investigationTools` or `resultTools`, inferring `execute`'s input type from `parameters`.
 * Throws {@link TrypatchFatalError} if `parameters` isn't a valid object schema.
 * @group Tools
 */
export function defineTool<
    InputSchema extends ToolParameters = undefined,
    ToolContext = unknown,
    Result = unknown,
> (definition: ToolDefinition<InputSchema, ToolContext, Result>): Tool<InputSchema, ToolContext, Result> {
    // Reject an invalid schema when the tool is defined rather than on its first call.
    const schema = toInputJsonSchema(definition.parameters, `Tool ${definition.name} parameters`)
    // Providers require tool input to be an object schema.
    if (typeof schema !== 'object' || schema.type !== 'object') {
        throw new TrypatchFatalError(`Tool ${definition.name} parameters must be an object schema`)
    }
    assertValidJsonSchema(definition.parameters, `Tool ${definition.name} parameters`)

    return { ...definition, name: toFunctionToolName(definition.name) }
}

export async function callTool<InputSchema extends ToolParameters, ToolContext, Result> (
    tool: Tool<InputSchema, ToolContext, Result>,
    input: unknown,
    context: ToolContext | undefined,
    options: { signal: AbortSignal | undefined },
): Promise<Awaited<Result>> {
    const parsed = parseParameter(tool.parameters, input, `parameters for tool ${tool.name}`) as SchemaInfer<InputSchema>

    return await withDeadline(async (signal): Promise<Awaited<Result>> => {
        return await tool.execute(parsed, context, { signal })
    }, {
        signal: options.signal,
        timeout: tool.timeoutMs === undefined ? undefined : { ms: tool.timeoutMs, label: `Tool ${tool.name}` },
    })
}
