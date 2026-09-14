import { getParser, getSchema, toFunctionToolName, type ToolParametersSchema } from './schema'
import type {
    ToolDefinition,
    ToolHandler,
    ToolInput,
    ToolInputValue,
} from './types'


async function callWithOptionalTimeout<Result> (
    call: () => Promise<Result>,
    timeoutMs: number | undefined,
    toolName: string,
): Promise<Result> {
    if (timeoutMs === undefined) {
        return call()
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            call(),
            new Promise<Result>((_resolve, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Tool ${toolName} timed out after ${timeoutMs}ms`))
                    return toolName
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId)
        }
    }
}

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

    async call (input: string, context?: Context): Promise<Awaited<Result>> {
        return callWithOptionalTimeout<Awaited<Result>>(async (): Promise<Awaited<Result>> => {
            const parsed = this.parser(input)
            return await this.execute(parsed, context)
        }, this.timeoutMs, this.name)
    }
}
