import { buildInvestigationContext, investigateError } from './investigation/investigate'
import type { Logger } from './logger'
import type { Schema } from './schema/types'
import type { AnyMethod, AnyMethodContext, TryPatchOptions } from './types'

export async function handleError<
    S extends Schema,
    C = unknown,
> (
    error: unknown,
    options: TryPatchOptions<S, C>,
    logger: Logger,
    context: AnyMethodContext,
    _method: AnyMethod,
    args: unknown[],
): Promise<unknown> {
    const investigationContext = buildInvestigationContext(error, context, args)

    try {
        return await investigateError(investigationContext, options)
    } catch (investigationError) {
        logger.error('[ssandir/trypatch] Investigation failed:', investigationError)
        return undefined
    }
}
