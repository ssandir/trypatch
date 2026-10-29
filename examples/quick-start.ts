// #region quick-start
import { z } from 'zod'
import { trypatch } from '@ssandir/trypatch'

export const QuoteSchema = z.object({
    price: z.number().describe('Price in the smallest currency unit, e.g. cents'),
    currency: z.string().describe('ISO 4217 currency code'),
})
export type Quote = z.infer<typeof QuoteSchema>

export class PricingService {
    @trypatch({
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: {
                provider: 'openai',
                apiKey: process.env.OPENAI_API_KEY!,
            },
        },
    })
    async getQuote (productId: string): Promise<Quote> {
        const response = await fetch(`https://pricing.example.com/products/${productId}/quote`)
        if (!response.ok) throw new Error(`Pricing API returned ${response.status}`)
        // Throws if the upstream changes its response shape
        return QuoteSchema.parse(await response.json())
    }
}
// #endregion quick-start

export const methodSourceOptions = {
    // #region method-source
    investigationBehavior: { allowMethodSource: true },
    // #endregion method-source
}
