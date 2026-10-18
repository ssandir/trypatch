/**
 * Investigation options resolve to an impossible state or internal state error happens (e.g. no outcome the AI could return).
 * @group Errors
 */
export class TrypatchConfigError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchConfigError'
    }
}
