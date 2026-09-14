import type { InvestigationContext, ResultSchema } from '../trypatchOptions'
import { toJsonSchemaObject } from '../schema/utils'

const DEFAULT_SYSTEM_PROMPT = [
    'You investigate runtime errors in application code.',
    'Analyze the provided error context and return a JSON object that matches the supplied schema exactly.',
    'Do not include markdown fences or explanatory text outside the JSON object.',
].join(' ')

export function buildInvestigationPrompt (
    ctx: InvestigationContext,
    resultSchema: ResultSchema | undefined,
    options: {
        prompt?: string | ((ctx: InvestigationContext) => string)
        systemPrompt?: string
    },
): { systemPrompt: string, userPrompt: string } {
    const errorMessage = ctx.error instanceof Error
        ? `${ctx.error.name}: ${ctx.error.message}\n${ctx.error.stack ?? ''}`
        : String(ctx.error)

    const defaultUserPrompt = [
        `Method: ${ctx.className ? `${ctx.className}.` : ''}${ctx.methodName}`,
        `Arguments: ${JSON.stringify(ctx.sanitizedArgs)}`,
        `Error:\n${errorMessage}`,
        ...resultSchema !== undefined
            ? [`Return JSON matching this schema:\n${JSON.stringify(toJsonSchemaObject(resultSchema), null, 2)}`]
            : [],
    ].join('\n\n')

    const userPrompt = typeof options.prompt === 'function'
        ? options.prompt(ctx)
        : options.prompt ?? defaultUserPrompt

    return {
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        userPrompt,
    }
}
