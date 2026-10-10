import { withDeadline } from '../abort/withDeadline'
import { runAiInvestigation } from './aiInvestigation/runAiInvestigation'
import { buildInvestigationContext } from './investigationContext'
import { TrypatchFatalError } from '../errors'
import type { Logger } from '../logger'
import type { Schema } from '../schema/types'
import type { CallTiming, InvestigationContext, MethodDescriptor, TrypatchOptions } from '../types'

export async function investigateError<
    S extends Schema,
    C = unknown,
> (
    ctx: InvestigationContext,
    options: TrypatchOptions<S, C>,
    logger?: Logger,
    signal?: AbortSignal,
): Promise<unknown> {
    return await withDeadline(
        async deadlineSignal => 'customInvestigation' in options
            ? await options.customInvestigation.investigate(ctx, { signal: deadlineSignal })
            : await runAiInvestigation(ctx, options.aiInvestigation, logger, deadlineSignal),
        { signal, timeout: { ms: options.timeoutMs, label: 'Investigation' } },
    )
}

function shouldPropagateCustomError (investigationError: unknown, options: TrypatchOptions<any, any>): boolean {
    return 'customInvestigation' in options
        ? options.customInvestigation.customErrors?.some(definition => investigationError instanceof definition.errorConstructor) ?? false
        : options.aiInvestigation.customErrors?.some(definition => definition.propagate && investigationError instanceof definition.errorConstructor) ?? false
}

export async function runInvestigation<
    S extends Schema,
    C = unknown,
> (
    error: unknown,
    options: TrypatchOptions<S, C>,
    logger: Logger,
    methodDescriptor: MethodDescriptor,
    receiver: unknown,
    args: unknown[],
    timing: CallTiming,
): Promise<unknown> {
    let signal: AbortSignal | undefined

    try {
        const investigationContext = buildInvestigationContext(error, methodDescriptor, receiver, args, timing)
        await options.onInvestigationStart?.(investigationContext)
        signal = options.getSignal?.(investigationContext)
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

        logger.error('[ssandir/trypatch] Investigation failed, rethrowing the original error', investigationError)
        throw error
    }
}
