/** AI investigation reported that none of the configured result/resultTools/customErrors fit; thrown only when `allowNoApplicableOutcome: true`. */
export class TrypatchNoApplicableOutcomeError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchNoApplicableOutcomeError'
    }
}
