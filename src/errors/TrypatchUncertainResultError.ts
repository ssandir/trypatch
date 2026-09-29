/** AI investigation had a candidate result but confidence was too low to return it; thrown only when `allowUncertainResult: true`. */
export class TrypatchUncertainResultError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchUncertainResultError'
    }
}
