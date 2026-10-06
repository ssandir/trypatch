import { getEventListeners } from 'node:events'
import { TrypatchTimeoutError } from '../errors'
import { mockTimeoutSignal } from '../test/abort'
import { withDeadline } from './withDeadline'

const hang = (): Promise<never> => new Promise<never>(() => undefined)

describe('withDeadline', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('should return the result', async () => {
        await expect(withDeadline(() => Promise.resolve('done'), {})).resolves.toBe('done')
    })

    it('should hand run a signal even without a timeout or outer signal', async () => {
        const run = jest.fn((signal: AbortSignal) => Promise.resolve(signal.aborted))

        await expect(withDeadline(run, {})).resolves.toBe(false)
        expect(run).toHaveBeenCalledWith(expect.any(AbortSignal))
    })

    it('should not apply a deadline when the timeout has no ms', async () => {
        const timeout = mockTimeoutSignal()
        const run = jest.fn((signal: AbortSignal) => Promise.resolve(signal.aborted))

        await expect(withDeadline(run, { timeout: { ms: undefined, label: 'Investigation' } })).resolves.toBe(false)
        expect(timeout).not.toHaveBeenCalled()
    })

    it('should reject with TrypatchTimeoutError when the timeout fires', async () => {
        const timeout = mockTimeoutSignal()

        const pending = withDeadline(hang, { timeout: { ms: 20, label: 'Investigation' } })

        await expect(pending).rejects.toBeInstanceOf(TrypatchTimeoutError)
        await expect(pending).rejects.toThrow('Investigation timed out after 20ms')
        expect(timeout).toHaveBeenCalledWith(20)
    })

    it('should stop waiting for a run that ignores the signal, aborting the signal it was given', async () => {
        const timeoutController = new AbortController()
        jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
        let runSignal: AbortSignal | undefined
        const pending = withDeadline((signal) => {
            runSignal = signal
            return hang()
        }, { timeout: { ms: 20, label: 'Tool hang' } })

        timeoutController.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

        await expect(pending).rejects.toHaveProperty('cause', runSignal?.reason)
        expect(runSignal?.aborted).toBe(true)
    })

    it('should rethrow the outer abort reason instead of the generic AbortError', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        const pending = withDeadline(signal => new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                reject(new DOMException('This operation was aborted', 'AbortError'))
            })
        }), {
            signal: controller.signal,
            timeout: { ms: 5_000, label: 'Investigation' },
        })

        controller.abort(reason)

        await expect(pending).rejects.toBe(reason)
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
