import { investigateError } from './investigation/investigate'
import { buildInvestigationContext } from './investigation/investigationContext'
import type { Logger } from './logger'
import type { Schema } from './schema/types'
import type { MethodDescriptor, TryPatchOptions } from './types'

export async function handleError<
    S extends Schema,
    C = unknown,
> (
    error: unknown,
    options: TryPatchOptions<S, C>,
    logger: Logger,
    methodDescriptor: MethodDescriptor,
    receiver: unknown,
    args: unknown[],
): Promise<unknown> {
    const investigationContext = buildInvestigationContext(error, methodDescriptor, receiver, args)

    try {
        return await investigateError(investigationContext, options)
    } catch (investigationError) {
        logger.error('[ssandir/trypatch] Investigation failed:', investigationError)
        return undefined
    }
}
