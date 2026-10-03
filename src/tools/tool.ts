import { withDeadline } from '../abort/withDeadline'
import { getParser, getSchema, toFunctionToolName, type ToolParametersSchema } from './schema'
import type {
    ToolDefinition,
    ToolHandler,
    ToolInput,
    ToolInputValue,
} from './types'


export class Tool<
    TSchema extends ToolInput = undefined,
    Context = unknown,
    Result = unknown,
> {
    readonly name: string
    readonly description: string
    readonly parameters: ToolParametersSchema<TSchema>
    readonly timeoutMs?: number

    private readonly parser: (input: string) => ToolInputValue<TSchema>
    private readonly execute: ToolHandler<TSchema, Context, Result>

    constructor (options: ToolDefinition<TSchema, Context, Result>) {
        const name = toFunctionToolName(options.name)

        this.name = name
        this.description = options.description
        this.parameters = getSchema(options.parameters) as ToolParametersSchema<TSchema>
        this.parser = getParser(options.parameters, name) as (input: string) => ToolInputValue<TSchema>
        this.execute = options.execute
        if (options.timeoutMs !== undefined) {
            this.timeoutMs = options.timeoutMs
        }
    }

    // TBD: make Tool.call  an internal function only the lib sees that is not exposed and make it's parameters required, consumer has no business calling this
    async call (input: string, context?: Context, options: { signal?: AbortSignal | undefined } = {}): Promise<Awaited<Result>> {
        return await withDeadline(async (signal): Promise<Awaited<Result>> => {
            const parsed = this.parser(input)
            return await this.execute(parsed, context, { signal })
        }, {
            signal: options.signal,
            timeout: this.timeoutMs === undefined ? undefined : { ms: this.timeoutMs, label: `Tool ${this.name}` },
        })
    }
}
