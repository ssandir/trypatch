import type { InvestigationContext } from '../../types'
import { qualifiedMethodName } from '../investigationContext'
import { formatForPrompt } from './formatForPrompt'

const DEFAULT_SYSTEM_PROMPT = [
    'A method call in application code threw an error, and you stand in for that call.',
    'Your outcome decides what the call returns to its caller in place of the error.',
    'Investigate the error, then choose an outcome from the supplied schema. Only return a result or invoke a result tool when that gives a correct return value for this call; if neither does, choose one of the other outcomes instead of inventing one.',
    'Respond with a single JSON object that matches the supplied schema exactly.',
].join(' ')

export function buildInvestigationPrompt (
    ctx: InvestigationContext,
    sanitizedArgs: unknown[],
    options: {
        prompt?: string | ((ctx: InvestigationContext) => string)
        systemPrompt?: string
        allowMethodSource?: boolean
    },
): { systemPrompt: string, userPrompt: string } {
    const methodName = qualifiedMethodName(ctx)

    const defaultUserPrompt = [
        `Method: ${methodName}`,
        `Method metadata: ${JSON.stringify(ctx.methodMetadata)}`,
        ...options.allowMethodSource
            ? [`Method source (as loaded at runtime, so it may be compiled or minified):\n${ctx.methodSource}`]
            : [],
        `Arguments: ${formatForPrompt(sanitizedArgs)}`,
        `Error:\n${formatForPrompt(ctx.error)}`,
        `Your outcome replaces this failed call to method ${methodName}.`,
    ].join('\n')

    const userPrompt = typeof options.prompt === 'function'
        ? options.prompt({ ...ctx, args: sanitizedArgs })
        : options.prompt ?? defaultUserPrompt

    return {
        systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        userPrompt,
    }
}
