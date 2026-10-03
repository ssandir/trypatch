import { TrypatchTimeoutError } from '../errors'

/**
 * Runs `run` under one signal that fires on our `timeout` or the outer `signal`, whichever comes first, and stops
 * waiting for `run` once it does, even if `run` ignores the signal.
 * Our timeout rejects with {@link TrypatchTimeoutError}; an outer abort is rethrown as its own reason.
 */
export async function withDeadline<Result> (
    run: (signal: AbortSignal) => Promise<Result>,
    { signal, timeout }: {
        signal?: AbortSignal | undefined
        timeout?: { ms: number, label: string } | undefined
    },
): Promise<Result> {
    const timeoutSignal = timeout ? AbortSignal.timeout(timeout.ms) : undefined
    const combinedSignal = AbortSignal.any([timeoutSignal, signal].filter(source => source !== undefined))

    try {
        combinedSignal.throwIfAborted()
        return await stopWaitingOnAbort(run(combinedSignal), combinedSignal)
    } catch (error) {
        // Our own deadline gets our own error, whatever `run` rejected with once it fired.
        if (timeout && timeoutSignal?.aborted) {
            throw new TrypatchTimeoutError(`${timeout.label} timed out after ${timeout.ms}ms`, { cause: error })
        }

        signal?.throwIfAborted()
        throw error
    }
}

// Stop waiting for work that ignores the signal.
async function stopWaitingOnAbort<Result> (work: Promise<Result>, signal: AbortSignal): Promise<Result> {
    const listener = new AbortController()
    const aborted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
            reject(signal.reason as Error)
        }, { once: true, signal: listener.signal })
    })

    try {
        return await Promise.race([work, aborted])
    } finally {
        listener.abort()
    }
}
