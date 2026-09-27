import { runAiInvestigation } from './aiInvestigation/runAiInvestigation'
import { buildInvestigationContext } from './investigationContext'
import type { Logger } from '../logger'
import type { Schema } from '../schema/types'
import type { InvestigationContext, MethodDescriptor, TryPatchOptions } from '../types'

export async function investigateError<
    S extends Schema,
    C = unknown,
> (
    ctx: InvestigationContext,
    options: TryPatchOptions<S, C>,
): Promise<unknown> {
    if ('customInvestigation' in options) {
        return await options.customInvestigation.investigate(ctx)
    }

    return await runAiInvestigation(ctx, options.aiInvestigation)
}

export async function runInvestigation<
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
