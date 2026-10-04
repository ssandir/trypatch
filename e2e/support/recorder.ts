// Captures what the investigation actually receives and sends: the provider's HTTP traffic (via
// the public `fetch` option), trypatch's log calls, and whatever else the test wants in the report.
import { mkdirSync, writeFileSync } from 'node:fs'
import type { LoggerLike } from '@ssandir/trypatch'

export type RecordedExchange = {
    url: string
    method: string
    requestHeaders: Record<string, string>
    requestBody: unknown
    status: number
    responseBody: unknown
    durationMs: number
}

export type RecordedLog = {
    level: keyof LoggerLike
    args: unknown[]
}

const SECRET_HEADERS = new Set(['x-api-key', 'authorization'])

function parseMaybeJson (text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function headersToRecord (headers: RequestInit['headers']): Record<string, string> {
    const record: Record<string, string> = {}
    new Headers(headers).forEach((value, key) => {
        record[key] = SECRET_HEADERS.has(key) ? `${value.slice(0, 7)}…(masked)` : value
    })
    return record
}

export function createRecordingFetch (exchanges: RecordedExchange[]): typeof fetch {
    return async (input, init) => {
        const url = input instanceof Request ? input.url : String(input)
        const rawBody = typeof init?.body === 'string' ? init.body : undefined
        const startedAt = Date.now()

        const response = await fetch(input, init)
        const responseText = await response.clone().text()

        exchanges.push({
            url,
            method: init?.method ?? 'GET',
            requestHeaders: headersToRecord(init?.headers),
            requestBody: rawBody === undefined ? '(non-string body)' : parseMaybeJson(rawBody),
            status: response.status,
            responseBody: parseMaybeJson(responseText),
            durationMs: Date.now() - startedAt,
        })

        return response
    }
}

export function createRecordingLogger (logs: RecordedLog[]): LoggerLike {
    const record = (level: keyof LoggerLike) => (...args: unknown[]) => {
        logs.push({ level, args })
    }
    return {
        debug: record('debug'),
        error: record('error'),
        info: record('info'),
        log: record('log'),
        warn: record('warn'),
    }
}

/** Errors serialize to `{}` by default; keep the parts worth reading, including what trypatch drops. */
export function serializeError (error: unknown): unknown {
    if (!(error instanceof Error)) {
        return error
    }
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause === undefined ? undefined : serializeError(error.cause),
        ownProperties: Object.fromEntries(Object.entries(error)),
    }
}

export function writeReport (name: string, report: unknown): string {
    const dir = new URL('../output/', import.meta.url)
    mkdirSync(dir, { recursive: true })
    const file = new URL(`${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir)
    writeFileSync(file, JSON.stringify(report, (_key, value: unknown) => value instanceof Error ? serializeError(value) : value, 2))
    return file.pathname
}
