// Stand-ins for the consumer's own clients, so examples type-check without showing their implementation.
import type { Quote } from './quick-start'

export type Report = { id: string, rows: unknown[] }

export declare const pricingClient: {
    fetchQuote: (productId: string) => Promise<Quote>
}
export declare const currencyClient: {
    toEur: (quote: Quote) => Promise<Quote>
}
export declare const reportClient: {
    generate: (reportId: string, options?: { signal?: AbortSignal }) => Promise<Report>
}
export declare const db: {
    query: (sql: string, params: unknown[]) => Promise<unknown[]>
}
export declare const secrets: {
    get: (name: string) => Promise<string>
}
export declare const Sentry: {
    captureException: (error: unknown, context?: { tags?: Record<string, string>, extra?: Record<string, unknown> }) => void
}
export declare const metrics: {
    increment: (name: string) => void
}
export declare const shutdownController: AbortController
export declare function getProxyToken (): Promise<string>
