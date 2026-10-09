// Real Claude call against the packed @ssandir/trypatch. Scenario: the carrier is briefly overloaded
// and answers 503 with a `Retry-After` header. A retry before that time gets 503 again, so the model
// has to wait it out with the built-in `trypatch_builtin_wait` tool before picking the retry result tool.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { inspect, styleText } from 'node:util'
import { defineTool, trypatch, type ResolvedOutcome } from '@ssandir/trypatch'
import { z } from 'zod'
import { startCarrierStub, type ApmEntry, type CarrierStub } from './support/carrierStub.ts'
import {
    createRecordingFetch,
    createRecordingLogger,
    writeReport,
    type RecordedExchange,
    type RecordedLog,
} from './support/recorder.ts'

function requireEnv (name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`${name} is not set. Export it or put it in e2e/.env; this test makes a real API call.`)
    }
    return value
}

const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY')

// Longer than a provider round trip, so retrying without waiting would still hit the 503.
const RETRY_AFTER_SECONDS = 15
const WAIT_TOOL_NAME = 'trypatch_builtin_wait'

const carrierApiKey = `ck_live_${randomBytes(12).toString('hex')}`
const carrierAccessToken = `ct_${randomBytes(16).toString('hex')}`

const exchanges: RecordedExchange[] = []
const logs: RecordedLog[] = []
const investigationEnds: ResolvedOutcome[] = []
const retryCalls: { input: unknown, at: string }[] = []
const apmLog: ApmEntry[] = []

// ---- "Application code" -------------------------------------------------------------------

type Order = {
    orderId: string
    customer: { name: string }
    destination: { line1: string, city: string, postalCode: string, country: string }
    parcels: { weightGrams: number }[]
}

const QuoteSchema = z.object({
    quoteId: z.string(),
    carrier: z.string(),
    service: z.enum(['standard', 'express']),
    priceCents: z.number().int(),
    currency: z.literal('EUR'),
    etaDays: z.number().int(),
})
type Quote = z.infer<typeof QuoteSchema>

const CarrierQuoteResponse = z.object({
    quote_id: z.string(),
    carrier: z.string(),
    service: z.enum(['standard', 'express']),
    price_cents: z.number().int(),
    currency: z.literal('EUR'),
    eta_days: z.number().int(),
})

type CarrierRequest = { method: string, url: string, headers: Record<string, string>, body: string }
type CarrierResponse = { status: number, headers: Record<string, string>, body: unknown }

// Shaped like an HTTP client's error: it carries the request it made and the response it got.
class CarrierError extends Error {
    readonly request: CarrierRequest
    readonly response: CarrierResponse

    constructor (message: string, options: { request: CarrierRequest, response: CarrierResponse }) {
        super(message)
        this.name = 'CarrierError'
        this.request = options.request
        this.response = options.response
    }
}

async function sendQuoteRequest (request: CarrierRequest): Promise<Quote> {
    const response = await fetch(request.url, request)
    const body: unknown = await response.json()
    if (!response.ok) {
        throw new CarrierError(`Carrier quote request failed with ${response.status}`, {
            request,
            response: { status: response.status, headers: Object.fromEntries(response.headers), body },
        })
    }

    const parsed = CarrierQuoteResponse.parse(body)
    return {
        quoteId: parsed.quote_id,
        carrier: parsed.carrier,
        service: parsed.service,
        priceCents: parsed.price_cents,
        currency: parsed.currency,
        etaDays: parsed.eta_days,
    }
}

type RetryToolContext = { failedRequests: Map<string, CarrierRequest> }

const failedRequests = new Map<string, CarrierRequest>()

const retryQuoteRequest = defineTool({
    name: 'retryQuoteRequest',
    description: 'Sends the failed carrier quote request for an order again and returns the quote it gets. Fails if the carrier still rejects it.',
    parameters: z.object({ orderId: z.string() }),
    execute: async (input, context: RetryToolContext | undefined): Promise<Quote> => {
        retryCalls.push({ input, at: new Date().toISOString() })
        const request = context?.failedRequests.get(input.orderId)
        if (!request) {
            throw new Error(`No failed quote request recorded for order ${input.orderId}`)
        }
        return await sendQuoteRequest(request)
    },
})

class ShippingQuoteClient {
    constructor (
        private readonly baseUrl: string,
        private readonly apiKey: string,
        private readonly accessToken: string,
    ) {}

    @trypatch({
        logging: { logger: createRecordingLogger(logs) },
        timeoutMs: 120_000,
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: {
                provider: 'claude',
                apiKey: anthropicApiKey,
                fetch: createRecordingFetch(exchanges),
            },
            resultTools: [retryQuoteRequest],
            toolContext: { failedRequests } satisfies RetryToolContext,
            redactConfig: { terms: [carrierApiKey] },
            // The only correct quote is one the carrier serves, so recovery has to go through the retry.
            investigationBehavior: { allowDirectResultCreation: false },
            onAiInvestigationEnd: (_ctx, outcome) => {
                investigationEnds.push(outcome)
            },
        },
    })
    async getQuote (order: Order): Promise<Quote> {
        const request: CarrierRequest = {
            method: 'POST',
            url: `${this.baseUrl}/v2/quotes?api_key=${this.apiKey}`,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${this.accessToken}` },
            body: JSON.stringify(order),
        }
        try {
            return await sendQuoteRequest(request)
        } catch (error) {
            failedRequests.set(order.orderId, request)
            throw error
        }
    }
}

// ---- Test ---------------------------------------------------------------------------------

type ToolUse = { type: 'tool_use', name: string, input: unknown }

function toolUses (exchange: RecordedExchange): ToolUse[] {
    const content = (exchange.responseBody as { content?: { type: string }[] } | undefined)?.content ?? []
    return content.filter((block): block is ToolUse => block.type === 'tool_use')
}

void describe('claude investigation of a transient carrier failure', () => {
    let stub: CarrierStub

    before(async () => {
        stub = await startCarrierStub(carrierApiKey, carrierAccessToken, apmLog)
    })

    after(async () => {
        await stub.close()
    })

    void it('waits out Retry-After with the built-in wait tool, then retries', { timeout: 180_000 }, async () => {
        const client = new ShippingQuoteClient(stub.baseUrl, carrierApiKey, carrierAccessToken)
        stub.throttle(RETRY_AFTER_SECONDS)

        let quote: Quote | undefined
        let thrown: unknown
        try {
            quote = await client.getQuote({
                orderId: 'ord_2001',
                customer: { name: 'Jonas Weber' },
                destination: { line1: 'Torstraße 1', city: 'Berlin', postalCode: '10119', country: 'DE' },
                parcels: [{ weightGrams: 1200 }],
            })
        } catch (error) {
            thrown = error
        }

        const waitCalls = exchanges.flatMap(toolUses).filter(toolUse => toolUse.name === WAIT_TOOL_NAME)
        const waitedMs = waitCalls.map(call => (call.input as { durationMs?: number }).durationMs)
        const requestBodies = exchanges.map(exchange => JSON.stringify(exchange.requestBody))
        const soft = {
            singleWait: waitCalls.length === 1,
            waitedAtLeastRetryAfter: waitedMs.some(ms => ms !== undefined && ms >= RETRY_AFTER_SECONDS * 1000),
            singleRetry: retryCalls.length === 1,
        }
        const reportPath = writeReport('claude-retry-after', {
            scenario: `carrier answers 503 with Retry-After: ${RETRY_AFTER_SECONDS}`,
            model: (exchanges[0]?.requestBody as { model?: string } | undefined)?.model,
            outcome: { quote, thrown },
            investigationEnds,
            waitCalls,
            retryCalls,
            apmLog,
            exchanges,
            logs,
            soft,
        })

        const color = (format: Parameters<typeof styleText>[0], value: string): string =>
            process.env.NO_COLOR ? value : styleText(format, value, { validateStream: false })
        const label = (value: string): string => color(['bold', 'white'], value)
        const output = (value: unknown): string => color('gray', typeof value === 'string' ? value : inspect(value, { depth: null }))
        console.log(`\n${label('Report:')} ${output(reportPath)}`)
        console.log(`${label('Provider requests:')} ${output(String(exchanges.length))}${label(', waits (ms):')} ${output(waitedMs)}${label(', retries:')} ${output(String(retryCalls.length))}`)
        console.log(`${label('Carrier responses:')} ${output(apmLog.map(entry => `${entry.at} ${entry.status}`))}`)
        console.log(`${label('Returned quote:')} ${output(quote ?? thrown)}`)
        console.log(`${label('Explanation:')} ${output(investigationEnds[0]?.explanation ?? '(none)')}`)
        console.log(`${label('Soft checks:')} ${output(soft)}`)

        assert.equal(thrown, undefined, 'getQuote should resolve with the retried Quote, not reject')
        assert.ok(quote)
        QuoteSchema.parse(quote)

        // The stub keeps answering 503 until Retry-After has passed, so a served quote means the retry waited long enough.
        const served = stub.served.at(-1) as { quote_id: string, price_cents: number, eta_days: number } | undefined
        assert.ok(served, 'the carrier should have served a quote to the retry')
        assert.equal(quote.quoteId, served.quote_id)
        assert.equal(quote.priceCents, served.price_cents)
        assert.equal(quote.etaDays, served.eta_days)
        assert.equal(apmLog[0]?.status, 503)
        assert.equal(apmLog.at(-1)?.status, 200)

        assert.equal(investigationEnds.length, 1)
        assert.equal(investigationEnds[0]?.type, 'result')
        assert.deepEqual(investigationEnds[0].result, quote)
        assert.ok(investigationEnds[0].explanation.trim())

        assert.ok(waitCalls.length > 0, `the model should have called ${WAIT_TOOL_NAME}`)
        assert.ok(retryCalls.length > 0, 'the model should have picked retryQuoteRequest')

        assert.ok(exchanges.length > 0 && exchanges.every(exchange => exchange.url.includes('/v1/messages')))
        assert.ok(requestBodies[0]?.includes(WAIT_TOOL_NAME), 'the built-in wait tool should be offered by default')
        assert.ok(requestBodies[0]?.includes('retry-after'), 'the Retry-After header should reach the prompt')
        for (const [index, body] of requestBodies.entries()) {
            assert.ok(!body.includes(carrierApiKey), `request ${index} leaked the carrier API key`)
            assert.ok(!body.includes(carrierAccessToken), `request ${index} leaked the carrier access token`)
        }

        assert.deepEqual(logs.filter(log => log.level === 'error'), [])
    })
})
