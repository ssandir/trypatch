// Real Claude call against the packed @ssandir/trypatch. Scenario: a carrier API starts answering
// `eta_days: null` (plus a new `eta_range`) for remote destinations, and the client's parser
// assumed the field is always an integer. trypatch should investigate and hand back a valid Quote.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { inspect, styleText } from 'node:util'
import { defineTool, trypatch, type InvestigationContext } from '@ssandir/trypatch'
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

// Fake secrets, random per run so a match in the captured traffic can only be a leak. Only the API key
// is listed in `redactConfig.terms`; the access token and email must be caught by the default detectors.
const carrierApiKey = `ck_live_${randomBytes(12).toString('hex')}`
const carrierAccessToken = `ct_${randomBytes(16).toString('hex')}`
const customerEmail = `maria.santana+${randomBytes(3).toString('hex')}@example.com`

const exchanges: RecordedExchange[] = []
const logs: RecordedLog[] = []
const investigationResults: { result: unknown, explanation: string }[] = []
const capturedContexts: InvestigationContext[] = []
const toolCalls: { input: unknown, output: unknown }[] = []
// Filled by the carrier stub; read by the investigation tool, like an APM backend would be.
const apmLog: ApmEntry[] = []

// ---- "Application code" -------------------------------------------------------------------

type Address = { line1: string, city: string, postalCode: string, country: string }
type Order = {
    orderId: string
    customer: { name: string, email: string }
    destination: Address
    parcels: { weightGrams: number }[]
}

const QuoteSchema = z.object({
    quoteId: z.string(),
    carrier: z.string(),
    service: z.enum(['standard', 'express']),
    priceCents: z.number().int(),
    currency: z.literal('EUR'),
    // Without this rule a range has no single correct value, and the model rightly refuses to guess.
    etaDays: z.number().int().describe('Maximum days until delivery.'),
})
type Quote = z.infer<typeof QuoteSchema>

const CarrierQuoteResponse = z.object({
    quote_id: z.string(),
    carrier: z.string(),
    service: z.enum(['standard', 'express']),
    price_cents: z.number().int(),
    currency: z.literal('EUR'),
    // this field always seems to be an integer
    eta_days: z.number().int(),
})

type ApmToolContext = { apmLog: ApmEntry[] }

type CarrierRequest = { method: string, url: string, headers: Record<string, string>, body: string }

// Shaped like an HTTP client's error: it carries the request it made, auth header included.
class CarrierError extends Error {
    readonly request: CarrierRequest

    constructor (message: string, options: { request: CarrierRequest, cause?: unknown }) {
        super(message, { cause: options.cause })
        this.name = 'CarrierError'
        this.request = options.request
    }
}

const getRecentCarrierCalls = defineTool({
    name: 'getRecentCarrierCalls',
    description: 'Returns the most recent HTTP calls to the shipping carrier API from the APM request log, newest last, including response bodies.',
    parameters: z.object({ limit: z.number().int().min(1).max(50) }),
    execute: (input, context: ApmToolContext | undefined) => {
        const output = context?.apmLog.slice(-input.limit) ?? []
        toolCalls.push({ input, output })
        return output
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
        getSignal: (ctx) => {
            capturedContexts.push(ctx)
            return undefined
        },
        timeoutMs: 120_000,
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: {
                provider: 'claude',
                apiKey: anthropicApiKey,
                fetch: createRecordingFetch(exchanges),
            },
            investigationTools: [getRecentCarrierCalls],
            toolContext: { apmLog } satisfies ApmToolContext,
            redactConfig: { terms: [carrierApiKey] },
            investigationBehavior: { allowUncertainResult: false },
            onInvestigationResult: (result, { explanation }) => {
                investigationResults.push({ result, explanation })
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
        const response = await fetch(request.url, request)
        if (!response.ok) {
            throw new CarrierError(`Carrier quote request failed with ${response.status}`, { request })
        }

        const parsed = CarrierQuoteResponse.safeParse(await response.json())
        if (!parsed.success) {
            throw new CarrierError('Carrier quote response did not match the expected schema', { request, cause: parsed.error })
        }

        const body = parsed.data
        return {
            quoteId: body.quote_id,
            carrier: body.carrier,
            service: body.service,
            priceCents: body.price_cents,
            currency: body.currency,
            etaDays: body.eta_days,
        }
    }
}

// ---- Test ---------------------------------------------------------------------------------

function order (orderId: string, destination: Address, weightGrams: number): Order {
    return {
        orderId,
        customer: { name: 'Maria Santana', email: customerEmail },
        destination,
        parcels: [{ weightGrams }],
    }
}

void describe('claude investigation', () => {
    let stub: CarrierStub

    before(async () => {
        stub = await startCarrierStub(carrierApiKey, carrierAccessToken, apmLog)
    })

    after(async () => {
        await stub.close()
    })

    void it('recovers a Quote when the carrier returns eta_days: null for a remote route', { timeout: 180_000 }, async () => {
        const client = new ShippingQuoteClient(stub.baseUrl, carrierApiKey, carrierAccessToken)

        // Normal traffic first, so the APM log has history to compare against.
        await client.getQuote(order('ord_1001', { line1: 'Torstraße 1', city: 'Berlin', postalCode: '10119', country: 'DE' }, 1200))
        await client.getQuote(order('ord_1002', { line1: '12 Rue de la République', city: 'Lyon', postalCode: '69002', country: 'FR' }, 800))
        assert.equal(exchanges.length, 0, 'healthy calls must not trigger an investigation')

        const remoteOrder = order('ord_1003', { line1: 'Calle Triana 40', city: 'Las Palmas de Gran Canaria', postalCode: '35002', country: 'ES' }, 2300)
        let quote: Quote | undefined
        let thrown: unknown

        try {
            quote = await client.getQuote(remoteOrder)
        } catch (error) {
            thrown = error
        }

        const servedRemote = stub.served.at(-1) as { quote_id: string, price_cents: number, eta_range: { min: number, max: number } }
        const requestBodies = exchanges.map(exchange => JSON.stringify(exchange.requestBody))
        const soft = {
            etaDaysIsRangeMax: quote?.etaDays === servedRemote.eta_range.max,
        }
        const reportPath = writeReport('claude', {
            scenario: 'carrier returns eta_days: null + eta_range for a remote route',
            model: exchanges[0]?.requestBody && (exchanges[0].requestBody as { model?: string }).model,
            outcome: { quote, thrown },
            investigationResults,
            servedRemote,
            capturedContext: capturedContexts.at(-1),
            toolCalls,
            exchanges,
            logs,
            soft,
        })

        // Print prompt text as-is; JSON.stringify would escape every newline. Our labels stay bright,
        // the captured output is dimmed so the labels are easy to scan.
        type TextBlock = { text?: string }
        const firstRequest = exchanges[0]?.requestBody as { system?: TextBlock[], messages?: { content: TextBlock[] }[] } | undefined
        const text = (blocks: TextBlock[] | undefined): string => blocks?.map(block => block.text).join('\n\n') ?? '(none)'
        // node --test runs this file in a child process whose stdout isn't a TTY, so styleText would strip colors.
        const color = (format: Parameters<typeof styleText>[0], value: string): string =>
            process.env.NO_COLOR ? value : styleText(format, value, { validateStream: false })
        const label = (value: string): string => color(['bold', 'white'], value)
        const output = (value: unknown): string => color('gray', typeof value === 'string' ? value : inspect(value, { depth: null }))
        console.log(`\n${label('Report:')} ${output(reportPath)}`)
        console.log(`${label('Provider requests:')} ${output(String(exchanges.length))}${label(', tool calls:')} ${output(String(toolCalls.length))}`)
        console.log(`\n${label('--- System prompt ---')}\n${output(text(firstRequest?.system))}`)
        console.log(`\n${label('--- First user message ---')}\n${output(text(firstRequest?.messages?.[0]?.content))}\n`)
        console.log(`${label('Returned quote:')} ${output(quote ?? thrown)}`)
        console.log(`${label('Explanation:')} ${output(investigationResults[0]?.explanation ?? '(none)')}`)
        console.log(`${label('Soft checks:')} ${output(soft)}`)

        assert.equal(thrown, undefined, 'getQuote should resolve with a recovered Quote, not reject')
        assert.ok(quote)
        QuoteSchema.parse(quote)

        assert.equal(quote.quoteId, servedRemote.quote_id)
        assert.equal(quote.carrier, 'dhl')
        assert.equal(quote.service, 'standard')
        assert.equal(quote.priceCents, servedRemote.price_cents)
        assert.equal(quote.currency, 'EUR')
        assert.ok(
            quote.etaDays >= servedRemote.eta_range.min && quote.etaDays <= servedRemote.eta_range.max,
            `etaDays ${quote.etaDays} should fall inside eta_range ${servedRemote.eta_range.min}-${servedRemote.eta_range.max}`,
        )

        assert.equal(investigationResults.length, 1)
        assert.deepEqual(investigationResults[0]?.result, quote)
        assert.ok(investigationResults[0]?.explanation.trim())

        assert.ok(toolCalls.length > 0, 'the model should have looked at the APM log; the raw response is only there')

        assert.ok(exchanges.length > 0 && exchanges.every(exchange => exchange.url.includes('/v1/messages')))
        assert.ok(requestBodies[0]?.includes('ShippingQuoteClient.getQuote'))
        assert.ok(requestBodies[0]?.includes('CarrierError'))
        // eta_days only appears in the ZodError, so this also checks the error's cause reached the prompt.
        assert.ok(requestBodies[0]?.includes('eta_days'))
        // The auth header is in the error's properties; it must be there, but as a placeholder.
        assert.ok(requestBodies[0]?.includes('[FR_BEARER_TOKEN_'), 'the error\'s request headers should reach the prompt redacted')
        for (const [index, body] of requestBodies.entries()) {
            assert.ok(!body.includes(carrierApiKey), `request ${index} leaked the carrier API key`)
            assert.ok(!body.includes(carrierAccessToken), `request ${index} leaked the carrier access token`)
            assert.ok(!body.includes(customerEmail), `request ${index} leaked the customer email`)
        }
        assert.ok(JSON.stringify(capturedContexts.at(-1)?.args).includes(customerEmail), 'redaction should happen at the provider boundary, not before')

        assert.deepEqual(logs.filter(log => log.level === 'error'), [])
    })
})
