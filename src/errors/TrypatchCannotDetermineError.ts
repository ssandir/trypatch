/** AI investigation reported it could not determine any result; thrown only when `investigationBehavior.allowCannotDetermine: true`. */
export class TrypatchCannotDetermineError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchCannotDetermineError'
    }
}
