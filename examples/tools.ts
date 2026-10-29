import { QuoteSchema, type Quote } from './quick-start'
import { pricingClient } from './shared'

// #region tools
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod/v4'
import { defineTool, trypatch } from '@ssandir/trypatch'

// Investigation tool: lets the AI see what the upstream actually sent
const fetchRawQuote = defineTool({
    name: 'fetchRawQuote',
    description: 'Fetch the raw, unparsed pricing API response for a product',
    parameters: z.object({ productId: z.string() }),
    execute: async ({ productId }) => {
        const response = await fetch(`https://pricing.example.com/products/${productId}/quote`)
        return `${response.status}\n${await response.text()}`
    },
})

// Result tool: its return value becomes getQuote's return value
const retryWithBackoff = defineTool({
    name: 'retryWithBackoff',
    description: 'Fetch the quote again with exponential backoff. Use for transient failures (timeouts, 5xx).',
    parameters: z.object({ productId: z.string(), delayMs: z.number(), maxAttempts: z.number() }),
    execute: async ({ productId, delayMs, maxAttempts }, _context, { signal }): Promise<Quote> => {
        for (let attempt = 0; ; attempt++) {
            try {
                return await pricingClient.fetchQuote(productId)
            } catch (error) {
                if (attempt >= maxAttempts - 1) throw error
                await sleep(delayMs * 2 ** attempt, undefined, { signal })
            }
        }
    },
})

export class PricingService {
    @trypatch({
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: {
                provider: 'claude',
                apiKey: process.env.ANTHROPIC_API_KEY!,
            },
            investigationTools: [fetchRawQuote],
            resultTools: [retryWithBackoff],
        },
    })
    async getQuote (productId: string): Promise<Quote> {
        return await pricingClient.fetchQuote(productId)
    }
}
// #endregion tools
