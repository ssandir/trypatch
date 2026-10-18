/**
 * Invalid trypatch usage (e.g. decorating something other than a method); always propagates.
 * @group Errors
 */
export class TrypatchFatalError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchFatalError'
    }
}
