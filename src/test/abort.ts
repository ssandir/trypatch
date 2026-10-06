// Our timeouts have already fired when the work would start, so tests check how we set and handle them without waiting for one.
export function mockTimeoutSignal (): jest.SpiedFunction<typeof AbortSignal.timeout> {
    return jest.spyOn(AbortSignal, 'timeout')
        .mockReturnValue(AbortSignal.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
}
