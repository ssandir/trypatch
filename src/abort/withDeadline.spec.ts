import { getEventListeners } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { TrypatchTimeoutError } from '../errors'
import { withDeadline } from './withDeadline'

const hang = (): Promise<never> => new Promise<never>(() => undefined)

describe('withDeadline', () => {
    it('should return the result', async () => {
        await expect(withDeadline(() => Promise.resolve('done'), {})).resolves.toBe('done')
    })

    it('should hand run a signal even without a timeout or outer signal', async () => {
        const run = jest.fn((signal: AbortSignal) => Promise.resolve(signal.aborted))

        await expect(withDeadline(run, {})).resolves.toBe(false)
        expect(run).toHaveBeenCalledWith(expect.any(AbortSignal))
    })

    it('should not apply a deadline when the timeout has no ms', async () => {
        const run = jest.fn((signal: AbortSignal) => Promise.resolve(signal.aborted))

        await expect(withDeadline(run, { timeout: { ms: undefined, label: 'Investigation' } })).resolves.toBe(false)
    })

    it('should reject with TrypatchTimeoutError when the timeout fires, with the signal reason as cause', async () => {
        let runSignal: AbortSignal | undefined
        const error = await withDeadline(async (signal) => {
            runSignal = signal
            return await sleep(5_000, undefined, { signal })
        }, { signal: new AbortController().signal, timeout: { ms: 20, label: 'Investigation' } }).catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(TrypatchTimeoutError)
        expect(error).toHaveProperty('message', 'Investigation timed out after 20ms')
        expect(runSignal?.aborted).toBe(true)
        expect(error).toHaveProperty('cause', runSignal?.reason)
    })

    it('should stop waiting for a run that ignores the signal', async () => {
        await expect(withDeadline(hang, { timeout: { ms: 20, label: 'Tool hang' } }))
            .rejects.toThrow('Tool hang timed out after 20ms')
    })

    it('should rethrow the outer abort reason instead of the generic AbortError', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        setTimeout(() => {
            controller.abort(reason)
        }, 20)

        await expect(withDeadline(signal => sleep(5_000, undefined, { signal }), {
            signal: controller.signal,
            timeout: { ms: 5_000, label: 'Investigation' },
        })).rejects.toBe(reason)
    })

    it('should not start when the outer signal is already aborted', async () => {
        const reason = new Error('cancelled')
        const run = jest.fn(() => Promise.resolve('done'))

        await expect(withDeadline(run, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
        expect(run).not.toHaveBeenCalled()
    })

    it('should pass other errors through unchanged', async () => {
        const failure = new Error('provider down')

        await expect(withDeadline(() => Promise.reject(failure), { timeout: { ms: 5_000, label: 'Investigation' } }))
            .rejects.toBe(failure)
    })

    it('should remove its abort listener once run settles', async () => {
        let runSignal: AbortSignal | undefined

        await withDeadline((signal) => {
            runSignal = signal
            return Promise.resolve('done')
        }, { signal: new AbortController().signal, timeout: { ms: 5_000, label: 'Investigation' } })

        expect(getEventListeners(runSignal!, 'abort')).toHaveLength(0)
    })
})
