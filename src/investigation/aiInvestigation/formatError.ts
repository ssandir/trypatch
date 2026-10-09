import { inspect } from 'node:util'

const INSPECT_OPTIONS = {
    depth: 6,
    maxArrayLength: 20,
    maxStringLength: 2_000,
    breakLength: 120,
} as const

/**
 * Formats a thrown value for the investigation prompt. `util.inspect` covers what `stack` leaves out:
 * own properties such as `code`/`errno`/`status`, the `cause` chain, an `AggregateError`'s errors, and
 * thrown non-errors. Secrets in it are left to the prompt's flare-redact vault.
 */
export function formatError (error: unknown): string {
    return inspect(error, INSPECT_OPTIONS)
}
