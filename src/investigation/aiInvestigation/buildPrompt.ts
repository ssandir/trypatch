import type { JSONSchema } from 'json-schema-to-ts'
import type { InvestigationContext } from '../../types'

const DEFAULT_SYSTEM_PROMPT = [
    'You investigate runtime errors in application code.',
    'Analyze the provided error context and return a JSON object that matches the supplied schema exactly.',
    'Do not include markdown fences or explanatory text outside the JSON object.',
].join(' ')

export function buildInvestigationPrompt (
    ctx: InvestigationContext,
    sanitizedArgs: unknown[],
    outcomeSchema: JSONSchema,
    options: {
        prompt?: string | ((ctx: InvestigationContext) => string)
        systemPrompt?: string
    },
): { systemPrompt: string, userPrompt: string } {
    const errorMessage = ctx.error instanceof Error
        ? `${ctx.error.name}: ${ctx.error.message}\n${ctx.error.stack ?? ''}`
        : String(ctx.error)

    const defaultUserPrompt = [
        `Method: ${ctx.methodMetadata.className ? `${ctx.methodMetadata.className}.` : ''}${ctx.methodName}`,
        `Method metadata: ${JSON.stringify(ctx.methodMetadata)}`,
        `Arguments: ${JSON.stringify(sanitizedArgs)}`,
        `Error:\n${errorMessage}`,
        `Return JSON matching this schema:\n${JSON.stringify(outcomeSchema, null, 2)}`,
    ].join('\n\n')

    const userPrompt = typeof options.prompt === 'function'
        ? options.prompt(ctx)
        : options.prompt ?? defaultUserPrompt

    return {
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        userPrompt,
    }
}
