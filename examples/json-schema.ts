import { currencyClient } from './shared'

// #region json-schema
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { defineTool, trypatch, type ResolvedOutcome } from '@ssandir/trypatch'

const quoteSchema = {
    type: 'object',
    properties: { price: { type: 'number' }, currency: { type: 'string' } },
    required: ['price', 'currency'],
    additionalProperties: false,
} as const satisfies JSONSchema
type Quote = FromSchema<typeof quoteSchema>

// Tool: annotate execute's input
const convertQuote = defineTool({
    name: 'convertQuote',
    description: 'Return the given quote converted to EUR',
    parameters: quoteSchema,
    execute: (input: Quote): Promise<Quote> => currencyClient.toEur(input),
})

// @trypatch: declare the return type, annotate the callback's outcome
export class PricingService {
    @trypatch({
        aiInvestigation: {
            resultSchema: quoteSchema,
            investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
            resultTools: [convertQuote],
            onAiInvestigationEnd: (_ctx, outcome: ResolvedOutcome<Quote>) => {
                if (outcome.type === 'result') console.warn(`Recovered ${outcome.result.price}: ${outcome.explanation}`)
            },
        },
    })
    async getQuote (productId: string): Promise<Quote> {
        return await currencyClient.toEur({ price: productId.length, currency: 'USD' })
    }
}
// #endregion json-schema
