import { inspect, type InspectOptions } from 'node:util'

export const INSPECT_OPTIONS = {
    // Deeper values stay reachable through the built-in read_call_context tool, so the prompt can stay small.
    depth: 4,
    maxArrayLength: 20,
    maxStringLength: 2_000,
    breakLength: 160,
} as const

/**
 * Formats a runtime value for the model: in the investigation prompt and in built-in tool output.
 * Unlike `JSON.stringify`, `util.inspect` doesn't throw on circular values or `BigInt`, keeps
 * `Map`/`Set` contents, class names and `undefined`, and caps size, so one large argument can't
 * blow up the prompt. For errors it adds what `stack` leaves out: own properties such as
 * `code`/`errno`/`status`, the `cause` chain and an `AggregateError`'s errors.
 */
export function formatForLLM (value: unknown, options?: Partial<InspectOptions>): string {
    return inspect(value, { ...INSPECT_OPTIONS, ...options })
}
