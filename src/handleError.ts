import { buildInvestigationContext, investigateError } from './investigation/investigate'
import type { Logger } from './logger'
import type { InferResult, ResultSchema, TryPatchOptions } from './trypatchOptions'

type MethodContext = ClassMethodDecoratorContext<unknown, (...args: unknown[]) => unknown>

export async function handleError<
    S extends ResultSchema,
    C = unknown,
> (
    error: unknown,
    options: TryPatchOptions<S, C>,
    logger: Logger,
    context: MethodContext,
    _method: (...args: unknown[]) => unknown,
    args: unknown[],
): Promise<unknown> {
    const sanitizeArgs = 'investigationProvider' in options
        ? options.investigationBehavior?.sanitizeArgs
        : undefined

    const investigationContext = buildInvestigationContext(
        error,
        context,
        args,
        sanitizeArgs,
    )

    try {
        const result = await investigateError(investigationContext, options)

        if ('resultSchema' in options && options.onInvestigationResult) {
            // To be adjusted once investigateError gets better return type
            await Promise.resolve(options.onInvestigationResult(result as InferResult<S>))
        }

        return result
    } catch (investigationError) {
        logger.error('[ssandir/trypatch] Investigation failed:', investigationError)
        return undefined
    }
}
