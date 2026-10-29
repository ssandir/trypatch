/**
 * AI investigation reported it could not determine any result; thrown only when `investigationBehavior.allowCannotDetermine: true`.
 * @group Errors
 */
export class TrypatchCannotDetermineError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchCannotDetermineError'
    }
}
