import type {
    InvestigationCannotDetermineOutcome,
    InvestigationNoApplicableOutcome,
    InvestigationUncertainOutcome,
} from './outcomeVariants'

export type { InvestigationCannotDetermineOutcome, InvestigationNoApplicableOutcome, InvestigationUncertainOutcome }

export type InvestigationErrorOutcome = {
    type: 'error'
    error: string
    errorSchema: unknown
}

export type InvestigationResultToolOutcome = {
    type: 'resultTool'
    explanation: string
    toolName: string
    input: unknown
}

export type InvestigationExplicitResultOutcome = {
    type: 'result'
    explanation: string
    /** Not parsed with `resultSchema` yet; a JSON-encoded string when there is none. */
    result: unknown
}

/**
 * Discriminated union an investigation provider's structured output must match:
 * a thrown {@link CustomErrorDefinition}, a call into a {@link ResultTool}, an explicit
 * result matching `resultSchema`, or a report that no proper result is available (`cannotDetermine`,
 * `uncertain`, `noApplicableOutcome`). Each branch is only present in
 * {@link buildInvestigationResultSchema}'s output when the matching option is configured.
 */
export type InvestigationOutcome
    = | InvestigationErrorOutcome
        | InvestigationResultToolOutcome
        | InvestigationExplicitResultOutcome
        | InvestigationCannotDetermineOutcome
        | InvestigationUncertainOutcome
        | InvestigationNoApplicableOutcome
