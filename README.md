# ssandir/trypatch

**Production-ready error investigation and automatic resolution.** When your functions fail, `trypatch` investigates the error in your production environment and either recovers it with custom tools or returns a structured diagnosis—all while keeping sensitive data local.

## What You Get

- 🔍 **On-the-fly Investigation**: When a method fails, AI analyzes the error context and generates actionable results
- 🛡️ **Schema-Based Guarantees**: All investigation results conform to a schema you define (Zod or JSON Schema)
- 🔐 **Automatic Credential Censoring**: Sensitive data is redacted before leaving your instance; placeholders are restored in responses
- 🔧 **Tool-Based Recovery**: Provide tools (e.g., `executeExternalApiCall`,`retryWithExponentialBackoff`, `fetchFromBackupService`) that trypatch can execute to resolve transient failures
- 🤖 **Multiple Providers**: OpenAI, Claude (Anthropic), or Cursor Cloud Agents for investigation logic

---

## Quick Start: Schema-Based Error Handling

Define what a resolved error should look like, and `@trypatch` ensures you always get that shape:

```typescript
import { z } from 'zod'
import { trypatch, Providers } from 'ssandir/trypatch'

const ResolutionSchema = z.object({
  rootCause: z.string().describe('Why the error occurred'),
  retryable: z.boolean().describe('Can this error be retried?'),
  suggestedAction: z.string().describe('What to do next'),
})

class PaymentService {
  @trypatch({
    resultSchema: ResolutionSchema,
    investigationProvider: {
      provider: Providesr.OPENAI,
      apiKey: process.env.OPENAI_API_KEY!,
    },
  })
  async processPayment(cardToken: string): Promise<z.infer<typeof ResolutionSchema>> {
    // If this fails, @trypatch investigates and returns a structured result
    const response = await fetch('https://api.payment.com/charge', {
      method: 'POST',
      body: JSON.stringify({ token: cardToken, amount: 100 }),
    })
    if (!response.ok) throw new Error(`Payment failed: ${response.statusText}`)
    return { rootCause: 'success', retryable: false, suggestedAction: 'none' }
  }
}
```

When `processPayment` fails:
- `@trypatch` captures the error and context
- OpenAI investigates: *"Why did the payment API return 503?"*
- Result always matches the schema: `{ rootCause, retryable, suggestedAction }`
- No guessing about failure reasons—you get structured answers

---

## Credential Censoring: Keep Secrets Local

Automatically redact API keys, tokens, and PII before they leave your instance:

```typescript
import { trypatch, Providers } from 'ssandir/trypatch'

class DatabaseService {
  @trypatch({
    resultSchema: ErrorResolutionSchema,
    investigationProvider: {
      provider: Providers.OPENAI,
      apiKey: process.env.OPENAI_API_KEY!,
    },
    // Redact sensitive terms before sending to OpenAI
    redactConfig: {
      terms: [
        process.env.DB_PASSWORD!,
        'super-secret-api-key',
        process.env.INTERNAL_SERVICE_TOKEN!,
      ],
    },
  })
  async queryDatabase(query: string) {
    // Even if query or password appears in error, it won't reach OpenAI
    const result = await db.query(query)
    return result
  }
}
```

**How it works:**
1. Before sending the investigation prompt to OpenAI, trypatch redacts all terms in `redactConfig.terms`
2. Placeholders (e.g., `[REDACTED_0]`) replace the sensitive values
3. OpenAI investigates with redacted data: *"Query failed at `[REDACTED_0]`..."*
4. Response placeholders are restored locally before returning
5. **Original secrets never leave your infrastructure**

---

## Tool-Based Recovery: Resolve Errors Automatically

Provide tools that trypatch can invoke to retry or recover from transient failures:

```typescript
import { Tool, trypatch, Providers } from 'ssandir/trypatch'
import { z } from 'zod'

const RetrySchema = z.object({
  success: z.boolean(),
  message: z.string(),
})

const retryTool = new Tool({
  name: 'retryWithBackoff',
  description: 'Retry the operation with exponential backoff',
  parameters: {
    type: 'object',
    properties: {
      delayMs: { type: 'number' },
      maxAttempts: { type: 'number' },
    },
    required: ['delayMs', 'maxAttempts'],
  },
  execute: async (input: { delayMs: number; maxAttempts: number }) => {
    // Your retry logic here
    for (let i = 0; i < input.maxAttempts; i++) {
      try {
        return await executeOriginalOperation()
      } catch (e) {
        if (i === input.maxAttempts - 1) throw e
        await sleep(input.delayMs * (2 ** i)) // exponential backoff
      }
    }
  },
})

class ThirdPartyApiClient {
  @trypatch({
    resultSchema: RetrySchema,
    investigationProvider: {
      provider: Providers.CURSOR,
      apiKey: process.env.CURSOR_API_KEY!,
    },
    // Tools the AI can call during investigation
    investigationTools: [retryTool],
  })
  async fetchData(endpoint: string) {
    // If this fails, Cursor investigates and may invoke retryWithBackoff
    const response = await fetch(`https://api.example.com${endpoint}`)
    if (!response.ok) throw new Error('API returned ' + response.status)
    return response.json()
  }
}
```

**Use cases:**
- **Volatile APIs**: `@trypatch` detects transient timeouts and retries automatically
- **Database connection pools**: Tools can wait for a connection to become available
- **Fallback services**: Tools can switch to a backup endpoint
- **Rate limiting**: Tools can apply backoff and retry intelligently

---

## JSON Schema and TypeScript

JSON Schema tool parameters and `@trypatch` result schemas map to `unknown`, not `FromSchema<T>`. Resolving
`FromSchema` through generic `Tool` / `@trypatch` types triggers TS2589 (excessively deep instantiation).
Runtime validation still runs (Ajv for tools; provider parsing for results). **Zod schemas infer types normally.**

For JSON Schema, define the shape locally and cast in handlers:

```typescript
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { Tool, trypatch, Providers } from 'ssandir/trypatch'

const schema = {
  type: 'object',
  properties: { rootCause: { type: 'string' }, retryable: { type: 'boolean' } },
  required: ['rootCause', 'retryable'],
  additionalProperties: false,
} as const satisfies JSONSchema
type Result = FromSchema<typeof schema>

// Tool — cast execute input
new Tool({
  name: 'investigate',
  description: 'Investigate',
  parameters: schema,
  execute: (input: unknown) => {
    const { rootCause, retryable } = input as Result
    return { summary: rootCause, retryable }
  },
})

// @trypatch — cast result / return type
class Service {
  @trypatch({
    resultSchema: schema,
    investigationProvider: { provider: Providers.OPENAI, apiKey: process.env.OPENAI_API_KEY! },
    onInvestigationResult: (result) => console.warn((result as Result).rootCause),
  })
  async run (): Promise<Result> { /* ... */ }
}
```

Use `as const satisfies JSONSchema` so `FromSchema<typeof schema>` stays precise.

---

## Claude (Anthropic)

`provider: Providers.CLAUDE` calls Anthropic's Messages API. `apiKey` is required; resolve it however you like (env var, secret manager, etc.) before passing it in.

```typescript
class Service {
  @trypatch({
    resultSchema: ResolutionSchema,
    investigationProvider: {
      provider: Providers.CLAUDE,
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
  })
  async run() { /* ... */ }
}
```

Optional fields: `model` (default `claude-sonnet-5`), `baseURL`, and `apiVersion` (`anthropic-version` header, default `2023-06-01`).

---

## Custom `fetch`: Proxying, Custom Auth, Retries

Every provider config accepts an optional `fetch`, used instead of the global one for every HTTP call that provider makes. It's the same pattern the Anthropic and OpenAI SDKs use — supply a function with `fetch`'s signature and do whatever you need before (or instead of) calling through to a real `fetch`: route through a proxy, inject a freshly refreshed token, add retries, log requests, etc.

```typescript
class Service {
  @trypatch({
    resultSchema: ResolutionSchema,
    investigationProvider: {
      provider: Providers.OPENAI,
      apiKey: process.env.OPENAI_API_KEY!,
      fetch: async (url, init) => fetch(`https://my-proxy.internal/openai?target=${encodeURIComponent(String(url))}`, {
        ...init,
        headers: { ...init?.headers, 'X-Proxy-Token': await getProxyToken() },
      }),
    },
  })
  async run() { /* ... */ }
}
```

Cursor's provider calls this for both the agent-creation and run-polling requests.
