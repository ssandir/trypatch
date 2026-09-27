import type { InvestigationOutcome } from './resultSchema'

/**
 * Parses a provider's raw response text into its {@link InvestigationOutcome}. The `result`/`errorSchema`/`input`
 * payloads are not yet validated against the caller's actual schemas — that happens centrally in
 * {@link investigateError} once the concrete `resultSchema`/`customErrors`/`resultTools` are known.
 */
export function parseProviderOutcome (content: string): InvestigationOutcome {
    const parsed = JSON.parse(content) as { outcome: InvestigationOutcome }
    return parsed.outcome
}
// TBD validate