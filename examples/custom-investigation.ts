import { type Quote } from './quick-start'
import { pricingClient } from './shared'

// #region custom-investigation
import { trypatch } from '@ssandir/trypatch'

class QuoteUnavailableError extends Error {}

export class PricingService {
    @trypatch({
        customInvestigation: {
            investigate: async (ctx, { signal }) => {
                const [productId] = ctx.args as [string]
                const cached = await fetch(`https://pricing-cache.example.com/${productId}`, { signal })
                if (!cached.ok) throw new QuoteUnavailableError(`No cached quote for ${productId}`)
                return await cached.json()
            },
            customErrors: [{ errorConstructor: QuoteUnavailableError }],
        },
    })
    async getQuote (productId: string): Promise<Quote> {
        return await pricingClient.fetchQuote(productId)
    }
}
// #endregion custom-investigation
