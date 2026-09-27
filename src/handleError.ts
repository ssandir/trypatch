import { buildInvestigationContext, investigateError } from './investigation/investigate'
import type { Logger } from './logger'
import type { SchemaInfer, Schema } from './schema/types'
import type { TryPatchOptions } from './trypatchOptions'

type MethodContext = ClassMethodDecoratorContext<unknown, (...args: unknown[]) => unknown>

export async function handleError<
    S extends Schema,
    C = unknown,
> (
    error: unknown,
    options: TryPatchOptions<S, C>,
    logger: Logger,
    context: MethodContext,
    _method: (...args: unknown[]) => unknown,
    args: unknown[],
): Promise<unknown> {
    const sanitizeArgs = 'aiInvestigation' in options
        ? options.aiInvestigation.investigationBehavior?.sanitizeArgs
        : undefined

    const investigationContext = buildInvestigationContext(
        error,
        context,
        args,
        sanitizeArgs,
    )

    try {
        const result = await investigateError(investigationContext, options)

        // TBD: this should be in called in investigation 
        if ('aiInvestigation' in options && options.aiInvestigation.onInvestigationResult) {
            await Promise.resolve(options.aiInvestigation.onInvestigationResult(result as SchemaInfer<S>))
        }

        return result
    } catch (investigationError) {
        logger.error('[ssandir/trypatch] Investigation failed:', investigationError)
        return undefined
    }
}
