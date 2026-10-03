import { runAiInvestigation } from './aiInvestigation/runAiInvestigation'
import { buildInvestigationContext } from './investigationContext'
import { TrypatchFatalError } from '../errors'
import type { Logger } from '../logger'
import type { Schema } from '../schema/types'
import type { InvestigationContext, MethodDescriptor, TryPatchOptions } from '../types'

export async function investigateError<
    S extends Schema,
    C = unknown,
> (
    ctx: InvestigationContext,
    options: TryPatchOptions<S, C>,
    logger?: Logger,
    signal?: AbortSignal,
): Promise<unknown> {
    signal?.throwIfAborted()

    if ('customInvestigation' in options) {
        return await options.customInvestigation.investigate(ctx, signal ? { signal } : {})
    }

    return await runAiInvestigation(ctx, options.aiInvestigation, logger, signal)
}

function shouldPropagateCustomError (investigationError: unknown, options: TryPatchOptions<any, any>): boolean {
    return 'customInvestigation' in options
        ? options.customInvestigation.customErrors?.some(definition => investigationError instanceof definition.errorConstructor) ?? false
        : options.aiInvestigation.customErrors?.some(definition => definition.propagate && investigationError instanceof definition.errorConstructor) ?? false
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
    let signal: AbortSignal | undefined

    try {
        signal = options.signal?.(investigationContext)
        return await investigateError(investigationContext, options, logger, signal)
    } catch (investigationError) {
        // Whoever controls a signal handles its abort.
        signal?.throwIfAborted()

        if (investigationError instanceof TrypatchFatalError) {
            throw investigationError
        }

        if (shouldPropagateCustomError(investigationError, options)) {
            throw investigationError
        }

        logger.error('[ssandir/trypatch] Investigation failed', investigationError)
        return undefined
    }
}
