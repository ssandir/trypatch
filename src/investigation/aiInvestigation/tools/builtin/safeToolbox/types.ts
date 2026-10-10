/** The failed call's data as the prompt shows it: its error and its arguments after `sanitizeArgs`. */
export type CallContext = {
    error: unknown
    args: unknown[]
}
