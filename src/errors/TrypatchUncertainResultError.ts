/**
 * The AI had a candidate return value, but too little confidence in it to return it. Passed to `onAiInvestigationEnd`; the decorated method rejects with its original error.
 * @group Errors
 */
export class TrypatchUncertainResultError extends Error {
    constructor (message: string) {
        super(message)
        this.name = 'TrypatchUncertainResultError'
    }
}
