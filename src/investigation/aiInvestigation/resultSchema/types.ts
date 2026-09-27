import type { Schema, SchemaInfer } from '../../../schema/types'

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
 * a thrown {@link CustomErrorDefinition}, a call into a {@link ResultTool}, or an explicit
 * result matching {@link Schema}. The `error` and `resultTool` branches are only present
 * in {@link buildInvestigationResultSchema}'s output when `customErrors`/`resultTools` are configured.
 */
export type InvestigationOutcome<S extends Schema = Schema>
    = | InvestigationErrorOutcome
        | InvestigationResultToolOutcome
        | InvestigationExplicitResultOutcome<S>
