import { TrypatchTimeoutError } from '../../errors'

/**
 * Runs `investigate` under one signal that fires on `timeoutMs` or the caller's `signal`, whichever comes first.
 * A timeout becomes {@link TrypatchTimeoutError}; a caller abort is rethrown as the caller's own reason.
 */
export async function withInvestigationDeadline<Result> (
    timeoutMs: number,
    signal: AbortSignal | undefined,
    investigate: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combinedSignal = AbortSignal.any([timeoutSignal, ...signal ? [signal] : []])

    try {
        combinedSignal.throwIfAborted()
        return await investigate(combinedSignal)
    } catch (error) {
        // Handle the timeout case separately. 
        if (timeoutSignal.aborted) {
            throw new TrypatchTimeoutError(`Investigation timed out after ${timeoutMs}ms`, { cause: error })
        }

        signal?.throwIfAborted()
        throw error
    }
}
