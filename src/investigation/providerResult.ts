import type { JSONSchema } from 'json-schema-to-ts'
import { createJsonSchemaValidator } from '../schema/utils'
import type { InvestigationOutcome } from './resultSchema'

/**
 * Parses a provider's raw response text into its {@link InvestigationOutcome}, validating it against
 * `outcomeSchema`. The nested `result`/`errorSchema`/`input` payloads are validated against the caller's
 * actual schemas separately, in {@link investigateError}.
 */
export function parseProviderOutcome (content: string, outcomeSchema: JSONSchema): InvestigationOutcome {
    const parsed: unknown = JSON.parse(content)
    createJsonSchemaValidator(outcomeSchema, 'investigation outcome')(parsed)

    return (parsed as { outcome: InvestigationOutcome }).outcome
}
