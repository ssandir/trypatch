// A fake shipping carrier API plus the APM-style request log an app would have in production.
// Remote routes (Canary Islands) come back with `eta_days: null` and an `eta_range` instead:
// the change the client below never expected. `throttle()` makes quote requests answer 503 with a
// `Retry-After` header until that time has passed, like an overloaded upstream.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export type ApmEntry = {
    at: string
    method: string
    url: string
    status: number
    durationMs: number
    responseBody: unknown
}

export type CarrierStub = {
    baseUrl: string
    /** Every quote body the stub served, in order, for asserting against what the AI reconstructed. */
    served: Record<string, unknown>[]
    /** Answer quote requests with 503 + `Retry-After` for the next `seconds`; a retry before then gets 503 again. */
    throttle: (seconds: number) => void
    close: () => Promise<void>
}

type QuoteRequest = {
    orderId: string
    destination: { country: string, postalCode: string }
    parcels: { weightGrams: number }[]
}

function isRemoteRoute (destination: QuoteRequest['destination']): boolean {
    // Las Palmas (35xxx) and Santa Cruz de Tenerife (38xxx)
    return destination.country === 'ES' && /^3[58]/.test(destination.postalCode)
}

function quoteFor (request: QuoteRequest, sequence: number): Record<string, unknown> {
    const weight = request.parcels.reduce((sum, parcel) => sum + parcel.weightGrams, 0)
    const base = {
        quote_id: `q_${(0x81f00 + sequence).toString(16)}`,
        carrier: 'dhl',
        service: 'standard',
        price_cents: 499 + Math.ceil(weight / 500) * 120,
        currency: 'EUR',
    }

    if (isRemoteRoute(request.destination)) {
        return { ...base, price_cents: base.price_cents + 1850, eta_days: null, eta_range: { min: 4, max: 9 } }
    }

    return { ...base, eta_days: request.destination.country === 'DE' ? 2 : 3 }
}

async function readJson (request: import('node:http').IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
        chunks.push(chunk as Buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function startCarrierStub (expectedApiKey: string, expectedAccessToken: string, apmLog: ApmEntry[]): Promise<CarrierStub> {
    const served: Record<string, unknown>[] = []
    let throttledUntil = 0

    const server: Server = createServer((request, response) => {
        const startedAt = Date.now()
        const url = new URL(request.url ?? '/', 'http://localhost')

        const respond = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
            apmLog.push({
                at: new Date(startedAt).toISOString(),
                method: request.method ?? 'GET',
                url: `${baseUrl}${url.pathname}${url.search}`,
                status,
                durationMs: Date.now() - startedAt + 40 + Math.floor(Math.random() * 80),
                responseBody: body,
            })
            response.writeHead(status, { 'content-type': 'application/json', ...headers })
            response.end(JSON.stringify(body))
        }

        if (url.searchParams.get('api_key') !== expectedApiKey) {
            respond(401, { error: 'invalid_api_key' })
            return
        }

        if (request.headers.authorization !== `Bearer ${expectedAccessToken}`) {
            respond(401, { error: 'invalid_access_token' })
            return
        }

        if (request.method !== 'POST' || url.pathname !== '/v2/quotes') {
            respond(404, { error: 'not_found' })
            return
        }

        if (Date.now() < throttledUntil) {
            const retryAfterSeconds = Math.ceil((throttledUntil - Date.now()) / 1000)
            respond(503, { error: 'service_unavailable', message: 'Quote service is temporarily overloaded' }, { 'retry-after': String(retryAfterSeconds) })
            return
        }

        readJson(request)
            .then((body) => {
                const quote = quoteFor(body as QuoteRequest, served.length)
                served.push(quote)
                respond(200, quote)
            })
            .catch(() => respond(400, { error: 'invalid_json' }))
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    return {
        baseUrl,
        served,
        throttle: (seconds) => {
            throttledUntil = Date.now() + seconds * 1000
        },
        close: async () => await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    }
}
