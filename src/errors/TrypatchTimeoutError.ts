/** The investigation ran past `timeoutMs`. */
export class TrypatchTimeoutError extends Error {
    constructor (message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'TrypatchTimeoutError'
    }
}
