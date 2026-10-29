import { trypatch } from '@ssandir/trypatch'
import { QuoteSchema, type Quote } from './quick-start'
import { metrics, pricingClient, Sentry } from './shared'

// #region investigation-start
export class PricingService {
    @trypatch({
        onInvestigationStart: ctx => {
            Sentry.captureException(ctx.error, { tags: { 'trypatch.method': ctx.methodName } })
        },
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
        },
    })
    async getQuote (productId: string): Promise<Quote> {
        return await pricingClient.fetchQuote(productId)
    }
}
// #endregion investigation-start

export class ReportedPricingService {
    @trypatch({
        // #region investigation-end
        aiInvestigation: {
            resultSchema: QuoteSchema,
            investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
            onAiInvestigationEnd: (ctx, outcome) => {
                if (outcome.type === 'result') {
                    metrics.increment('pricing.quote_recovered')
                    return
                }
                Sentry.captureException(ctx.error, {
                    tags: { 'trypatch.method': ctx.methodName },
                    extra: { investigationError: outcome.error.message, explanation: outcome.explanation },
                })
            },
        },
        // #endregion investigation-end
    })
    async getQuote (productId: string): Promise<Quote> {
        return await pricingClient.fetchQuote(productId)
    }
}
