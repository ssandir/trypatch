# @ssandir/trypatch

**Production-ready error recovery.** When a method fails, `@trypatch` investigates the error immediately at runtime and returns the value the method should have returned, by running your tools or having the AI build it. Sensitive data stays local. If no correct value can be produced, the method rethrows its original error. Fully customizable behavior.

- 🔍 **On-the-fly recovery**: the AI investigates the failed call and returns its value. [How recovery works](docs/recovery.md)
- 🛡️ **Schema-checked values**: a value the AI builds is validated against your `resultSchema` (Zod or JSON Schema). [Schemas](docs/schemas.md)
- 🔐 **Redaction**: secrets are replaced with placeholders before anything leaves your process. [Redaction](docs/redaction.md)
- 🔧 **Tools**: investigation tools to look around, result tools to recover (retries, fallbacks, cache reads). [Tools](docs/tools.md), [MCP servers](docs/mcp-servers.md)
- 🧾 **No silent fallbacks**: without a correct value, callers get the original error. [How recovery works](docs/recovery.md#when-no-value-is-produced)
- 🤖 **Providers**: OpenAI, Claude, any OpenAI-compatible endpoint, or Cursor Cloud Agents. [Providers](docs/providers.md)

## Install

```bash
npm install @ssandir/trypatch zod
```

Requires Node.js 22.12 or later. Zod schemas work with `zod` `^3.25.76` or `^4.1.8`, imported from `zod/v4`. [Schemas](docs/schemas.md)

## Quick start

```typescript
import { z } from 'zod/v4'
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
```

When `getQuote` fails, the AI works out the `Quote` it should have returned. The value is validated against `QuoteSchema` and returned as if `getQuote` had succeeded; if there's no correct `Quote`, `getQuote` rethrows its original error.

## Documentation

- [How recovery works](docs/recovery.md): outcomes, fallbacks, custom investigations, decorator dialects
- [Tools](docs/tools.md): investigation and result tools, the tool loop, the built-in safe toolbox
- [MCP servers](docs/mcp-servers.md)
- [Redaction](docs/redaction.md)
- [Cancellation](docs/cancellation.md): abort signals and timeouts
- [Monitoring](docs/monitoring.md): callbacks and logging
- [Schemas](docs/schemas.md)
- [Providers](docs/providers.md)

Every option is documented on its type, so your editor shows it on hover. Guides and the API reference are also on [trypatch.dev](https://trypatch.dev).
