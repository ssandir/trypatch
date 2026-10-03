import { setTimeout as sleep } from 'node:timers/promises'
import { TrypatchTimeoutError } from '../../errors'
import { withInvestigationDeadline } from './deadline'

describe('withInvestigationDeadline', () => {
    it('should return the investigation result', async () => {
        await expect(withInvestigationDeadline(5_000, undefined, () => Promise.resolve('done'))).resolves.toBe('done')
    })

    it('should throw TrypatchTimeoutError with the abort as cause when the timeout fires', async () => {
        const error = await withInvestigationDeadline(20, new AbortController().signal, signal => sleep(5_000, undefined, { signal }))
            .catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(TrypatchTimeoutError)
        expect(error).toHaveProperty('message', 'Investigation timed out after 20ms')
        expect(error).toHaveProperty('cause', expect.objectContaining({ name: 'AbortError' }))
    })

    it('should rethrow the caller\'s abort reason instead of the generic AbortError', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        setTimeout(() => {
            controller.abort(reason)
        }, 20)

        await expect(withInvestigationDeadline(5_000, controller.signal, signal => sleep(5_000, undefined, { signal })))
            .rejects.toBe(reason)
    })

    it('should not start the investigation when the caller signal is already aborted', async () => {
        const reason = new Error('cancelled')
        const investigate = jest.fn(() => Promise.resolve('done'))

        await expect(withInvestigationDeadline(5_000, AbortSignal.abort(reason), investigate)).rejects.toBe(reason)
        expect(investigate).not.toHaveBeenCalled()
    })

    it('should pass other errors through unchanged', async () => {
        const failure = new Error('provider down')

        await expect(withInvestigationDeadline(5_000, undefined, () => Promise.reject(failure))).rejects.toBe(failure)
    })
})
