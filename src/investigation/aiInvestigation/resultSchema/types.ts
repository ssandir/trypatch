import type { Schema, SchemaInfer } from '../../../schema/types'
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
    toolName: string
    input: unknown
}

export type InvestigationExplicitResultOutcome<S extends Schema = Schema> = {
    type: 'result'
    result: SchemaInfer<S>
}

/**
 * Discriminated union an investigation provider's structured output must match:
 * a thrown {@link CustomErrorDefinition}, a call into a {@link ResultTool}, an explicit
 * result matching {@link Schema}, or a report that no proper result is available (`cannotDetermine`,
 * `uncertain`, `noApplicableOutcome`). Each branch is only present in
 * {@link buildInvestigationResultSchema}'s output when the matching option is configured.
 */
export type InvestigationOutcome<S extends Schema = Schema>
    = | InvestigationErrorOutcome
        | InvestigationResultToolOutcome
        | InvestigationExplicitResultOutcome<S>
        | InvestigationCannotDetermineOutcome
        | InvestigationUncertainOutcome
        | InvestigationNoApplicableOutcome
