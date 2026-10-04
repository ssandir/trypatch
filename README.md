# @ssandir/trypatch

**Production-ready error recovery.** When a method fails, `trypatch` investigates the error in your production environment and recovers from it by either running provided tools or generating the return value. Sensitive data stays local throughout. If no correct value can be produced, the method rethrows its original error.

## What You Get

- 🔍 **On-the-fly Recovery**: When a method fails, AI investigates the error context and produces the value the method should have returned
- 🛡️ **Schema-Based Guarantees**: `resultSchema` describes your method's return type (Zod or JSON Schema), and a value the AI builds is validated against it before it reaches the caller
- 🔐 **Automatic Credential Censoring**: Sensitive data is redacted before leaving your instance; placeholders are restored in responses
- 🔧 **Tool-Based Recovery**: Provide result tools (e.g. `retryWithBackoff`, `fetchFromBackupService`) whose return value becomes the method's return value, and investigation tools the AI can use to look around first
- 🧾 **No Silent Fallbacks**: If the investigation can't produce a correct value, callers get the method's original error
- 🤖 **Multiple Providers**: OpenAI, Claude (Anthropic), any OpenAI-compatible endpoint (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...), or Cursor Cloud Agents for investigation logic

Requires Node.js 22 or later. Decorated methods must be `async` (or return a `Promise`): recovering a value takes network calls, so the decorated method always returns a Promise.

---

## Quick Start: Recover the Return Value

`resultSchema` is the shape your method returns. When the method fails, `@trypatch` asks the AI for the value it should have returned:

```typescript
import { z } from 'zod'
import { trypatch } from '@ssandir/trypatch'

const QuoteSchema = z.object({
  price: z.number().describe('Price in the smallest currency unit, e.g. cents'),
  currency: z.string().describe('ISO 4217 currency code'),
})
type Quote = z.infer<typeof QuoteSchema>

class PricingService {
  @trypatch({
    aiInvestigation: {
      resultSchema: QuoteSchema,
      investigationProvider: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
      },
    },
  })
  async getQuote(productId: string): Promise<Quote> {
    const response = await fetch(`https://pricing.example.com/products/${productId}/quote`)
    if (!response.ok) throw new Error(`Pricing API returned ${response.status}`)
    // Throws if the upstream changes its response shape
    return QuoteSchema.parse(await response.json())
  }
}
```

When `getQuote` fails:
- `@trypatch` captures the error, the method name and its arguments
- The AI works out the `Quote` this call should have returned, using the error context and any [tools](#tool-based-recovery-resolve-errors-automatically) you give it
- The value is validated against `QuoteSchema` and returned to the caller as if `getQuote` had succeeded
- If the AI can't produce a correct `Quote`, `getQuote` rethrows its original error (see [Fallback Outcomes](#fallback-outcomes-avoiding-fabricated-results))

The type of `getQuote` is checked against `resultSchema`: with standard (stage-3) decorators, a method that doesn't return `Promise<Quote>` is a compile error.

### Explanations: Why a Value Was Returned

Along with the value, the AI explains why the call failed and why its value is correct. Callers only get the value. trypatch logs the explanation with `logger.info`, as the argument after the message, so it only shows at `verbosity: 'high'`. It also passes the explanation to `onInvestigationResult`:

<details>
<summary>Example</summary>

```typescript
aiInvestigation: {
  resultSchema: QuoteSchema,
  investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
  onInvestigationResult: (quote, { explanation }) => {
    metrics.increment('pricing.quote_recovered')
    console.warn(`getQuote recovered ${quote.price} ${quote.currency}: ${explanation}`)
  },
}
```

</details>

With `redactConfig`, placeholders in the explanation are restored like the rest of the response, so treat it as sensitive.

---

## Credential Censoring: Keep Secrets Local

Automatically redact API keys, tokens, and PII before they leave your instance:

<details>
<summary>Example</summary>

```typescript
import { z } from 'zod'
import { trypatch } from '@ssandir/trypatch'

const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(['free', 'pro', 'enterprise']),
})
type Customer = z.infer<typeof CustomerSchema>

class CustomerRepository {
  @trypatch({
    aiInvestigation: {
      resultSchema: CustomerSchema,
      investigationProvider: {
        provider: 'openai',
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
    },
  })
  async getCustomer(customerId: string): Promise<Customer> {
    // Even if the password appears in the error, it won't reach OpenAI
    const [row] = await db.query('SELECT id, name, tier FROM customers WHERE id = $1', [customerId])
    return CustomerSchema.parse(row)
  }
}
```

</details>

**How it works:**
1. Before sending the investigation prompt to OpenAI, trypatch redacts all terms in `redactConfig.terms`
2. Placeholders (e.g., `[REDACTED_0]`) replace the sensitive values
3. OpenAI investigates with redacted data: *"Query failed at `[REDACTED_0]`..."*
4. When the AI calls an investigation tool, placeholders in its input are restored before the tool runs, and the tool's output is redacted before it goes back to the AI
5. Response placeholders are restored locally before the value is returned
6. **Original secrets never leave your infrastructure**

---

## Tool-Based Recovery: Resolve Errors Automatically

There are two kinds of tools:

- **Investigation tools** (`investigationTools`): the AI calls them while investigating and reads their output. Their output only goes back to the AI, never to your caller. Keep them read-only.
- **Result tools** (`resultTools`): the AI picks one as its outcome, together with its input. trypatch calls it once the investigation is done, and **its return value is what the decorated method returns**. This is where recovery actions belong: retries, fallbacks, cache reads.

<details>
<summary>Example</summary>

```typescript
import { Tool, trypatch } from '@ssandir/trypatch'
import { z } from 'zod'

// Investigation tool: lets the AI see what the upstream actually sent
const fetchRawQuote = new Tool({
  name: 'fetchRawQuote',
  description: 'Fetch the raw, unparsed pricing API response for a product',
  parameters: z.object({ productId: z.string() }),
  execute: async ({ productId }) => {
    const response = await fetch(`https://pricing.example.com/products/${productId}/quote`)
    return `${response.status}\n${await response.text()}`
  },
})

// Result tool: its return value becomes getQuote's return value
const retryWithBackoff = new Tool({
  name: 'retryWithBackoff',
  description: 'Fetch the quote again with exponential backoff. Use for transient failures (timeouts, 5xx).',
  parameters: z.object({ productId: z.string(), delayMs: z.number(), maxAttempts: z.number() }),
  execute: async ({ productId, delayMs, maxAttempts }): Promise<Quote> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await pricingClient.fetchQuote(productId)
      } catch (error) {
        if (attempt >= maxAttempts - 1) throw error
        await sleep(delayMs * 2 ** attempt)
      }
    }
  },
})

class PricingService {
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
  async getQuote(productId: string): Promise<Quote> {
    const response = await fetch(`https://pricing.example.com/products/${productId}/quote`)
    if (!response.ok) throw new Error(`Pricing API returned ${response.status}`)
    return QuoteSchema.parse(await response.json())
  }
}
```

</details>

<details>
<summary>Tool loop details and limits</summary>

The AI can call investigation tools over several turns: it calls a tool, reads the result, keeps investigating (possibly calling more tools), and then returns its outcome.

- `investigationBehavior.maxToolIterations` caps the number of tool turns (default 20)
- `timeoutMs` covers the whole investigation, including every tool turn; a tool still running at the deadline is abandoned, and can listen to the `signal` it receives to actually stop (see [Cancellation](#cancellation-abort-signals))
- `toolContext` is passed to every tool's `execute` as its second argument, and `{ signal }` as its third
- If an investigation tool throws, the error is sent back to the AI so it can try something else, instead of failing the investigation
- A result tool runs after the model picks it, but within `timeoutMs`; its own `timeoutMs` still applies. If it throws, the investigation fails, and the method rethrows its original error.
- A result tool's return type is checked against `resultSchema` at compile time. Its value isn't validated at runtime, because it's your code.

Investigation tools work with `openai`, `claude` and `openai-compatible`. The `cursor` provider ignores them, because Cursor's cloud agent runs its own tools remotely; use [`mcpServers`](#mcp-servers-give-the-ai-your-existing-tooling) to give it tools.

</details>

**Use cases:**
- **Volatile APIs**: a result tool retries with backoff, and the retried value is returned
- **Changed upstream formats**: an investigation tool fetches the raw response, and the AI returns a valid value built from it
- **Fallback services**: a result tool reads from a backup endpoint or cache
- **Database connection pools**: a result tool waits for a connection and runs the query again

---

## MCP Servers: Give the AI Your Existing Tooling

`mcpServers` connects the investigation to [MCP](https://modelcontextprotocol.io) servers, and the AI can call their tools the same way it calls `investigationTools`. You define the servers; trypatch ships no presets.

<details>
<summary>Example</summary>

```typescript
aiInvestigation: {
  investigationProvider: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY! },
  mcpServers: [
    {
      name: 'grafana',
      type: 'http', // or 'sse'
      url: 'https://mcp.internal/grafana',
      headers: async () => ({ Authorization: `Bearer ${await secrets.get('grafana-token')}` }),
      allowedTools: ['query_logs', 'get_dashboard'],
    },
    {
      name: 'db',
      type: 'stdio',
      command: 'npx',
      args: ['some-db-mcp'],
      env: { DATABASE_URL: process.env.READONLY_DATABASE_URL! },
    },
  ],
}
```

</details>

<details>
<summary>Server options and behavior</summary>

- **Tool names:** the AI sees each tool as `<server name>__<tool name>` (`grafana__query_logs`), so two servers can't collide. Server names may only contain letters, digits, `_` and `-`.
- **Auth:** static `headers`, or a `headers` function that is called once per investigation (short-lived tokens, secret managers, client-credentials OAuth where you fetch the token yourself). Stdio servers get secrets through `env`. Interactive OAuth isn't supported: nobody is around to complete a browser login when an error fires on a server.
- **Recommended: read-only tools.** The AI decides which tools to call, and MCP servers often expose tools that change things (`delete_*`, `create_*`). Narrow each server with `allowedTools`. trypatch doesn't enforce this; which servers and tools to expose is your call.
- **Connection lifetime:** servers are connected when an investigation starts and closed when it ends. For stdio that means starting a new process on every investigated failure.
- **Unavailable servers don't fail the investigation.** A server that refuses to connect (or whose `headers` function throws) is logged as a warning and skipped. The AI investigates with the tools it has, and can fall back to one of the [fallback outcomes](#fallback-outcomes-avoiding-fabricated-results) if they aren't enough.
- MCP tools share `maxToolIterations`, `timeoutMs` (which also covers connecting) and `redactConfig` with `investigationTools`: the AI only sees redacted values, and MCP tool output is redacted before it reaches the provider. Tool descriptions are sent unredacted.

</details>

<details>
<summary>Why trypatch connects to MCP servers itself, and how Cursor differs</summary>

**Why trypatch connects to MCP servers itself.** OpenAI and Anthropic can also connect to MCP servers from their own cloud. trypatch deliberately connects locally for `openai`, `claude` and `openai-compatible`:

- **Internal servers work.** Hosted MCP only reaches servers on the public internet. The servers most useful for investigating errors (internal Grafana, databases, internal APIs) usually aren't.
- **stdio works.** Hosted MCP only supports remote servers.
- **Redaction applies.** With hosted MCP, tool calls go directly between the provider and the server, where `redactConfig` can't see them. Your MCP credentials would also have to be sent to the provider.
- **Limits apply.** Hosted tool calls happen inside a single API call, out of reach of `maxToolIterations` and the investigation deadline.
- **One behaviour everywhere.** `openai-compatible` has no hosted MCP, and Anthropic's connector only takes a single bearer token.
- **Failures are handled.** An unreachable server is skipped with a warning instead of failing the provider call.

**Cursor** is the exception: its Cloud Agents API runs MCP itself, so trypatch passes the servers through. Stdio servers run inside Cursor's cloud VM (`cwd` and `fetch` are ignored), and `headers`/`env` are sent to Cursor, which stores them encrypted and deletes them with the agent. `redactConfig` doesn't cover MCP traffic there, `allowedTools` isn't supported (setting it throws a `TrypatchConfigError`), and a server Cursor can't reach is handled by Cursor, not reported by trypatch.

</details>

---

## Fallback Outcomes: Avoiding Fabricated Results

Besides returning a `result`, calling a `resultTool`, or throwing a `customErrors` entry, the AI can report that it has no correct value to offer, instead of guessing one. Three booleans control this, all defaulting to `true`:

- `allowCannotDetermine`: not enough information to work out a correct return value → `TrypatchCannotDetermineError`
- `allowUncertainResult`: a candidate value exists, but confidence is too low to return it → `TrypatchUncertainResultError`
- `allowNoApplicableOutcome`: none of the configured `result`/`resultTools`/`customErrors` fit the situation → `TrypatchNoApplicableOutcomeError`

The AI supplies a `reason` string, which becomes that error's message. Set the corresponding boolean to `false` to remove that escape hatch.

**When no value is produced, callers get the original error.** That covers a fallback outcome, a `customErrors` entry without `propagate`, our timeout, a provider failure or a failing result tool. trypatch logs why the investigation failed, and the method rethrows the error it originally threw, so callers see the same failure they'd see without trypatch. Only three errors replace it:

- the abort reason of the signal returned by `getSignal` (see [Cancellation](#cancellation-abort-signals))
- `TrypatchFatalError`
- a `customErrors` entry with `propagate: true`

---

## Cancellation: Abort Signals

A signal can abort an investigation, e.g. when the calling request is cancelled. Decorator options are evaluated once, but a caller's signal exists per call, so `getSignal` gets the investigation context (including the call's arguments) and returns that call's signal.

<details>
<summary>Example</summary>

```typescript
class ReportService {
  @trypatch({
    getSignal: ctx => (ctx.args[1] as { signal?: AbortSignal } | undefined)?.signal,
    timeoutMs: 60_000,
    aiInvestigation: {
      investigationProvider: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY! },
    },
  })
  async generate(reportId: string, options?: { signal?: AbortSignal }): Promise<Report> { /* ... */ }
}
```

</details>

For a signal not tied to a call, such as app shutdown: `getSignal: () => shutdownController.signal`.

<details>
<summary>Details</summary>

- **Your abort, your error.** The decorated method rejects with the signal's `reason`, like `fetch` does. An already-aborted signal skips the investigation.
- **Our timeout, our error.** `timeoutMs` and your signal are combined. If the timeout fires first, trypatch logs a `TrypatchTimeoutError` and the method rethrows its original error, like any investigation failure.
- **Tools** get `{ signal }` as `execute`'s third argument; it also fires on the tool's own `timeoutMs` (throwing `TrypatchTimeoutError`). A tool still running is abandoned; listen to `signal` to actually stop it. Result tools get the same combined signal, so `timeoutMs` covers them too.
- **MCP** connections and tool calls share the combined signal.
- **Custom investigations** get `investigate(ctx, { signal })`; the signal also fires on `timeoutMs` (if set, throwing `TrypatchTimeoutError`). An `investigate` that ignores the signal is abandoned.
- **Cursor** stops polling on abort; the remote agent keeps running.

</details>

---

## JSON Schema and TypeScript

<details>
<summary>Details and example</summary>

JSON Schema tool parameters and `@trypatch` result schemas map to `unknown`, not `FromSchema<T>`. Resolving
`FromSchema` through generic `Tool` / `@trypatch` types triggers TS2589 (excessively deep instantiation).
Runtime validation still runs (Ajv for tools; provider parsing for results). **Zod schemas infer types normally.**

For JSON Schema, define the shape locally and cast in handlers:

```typescript
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { Tool, trypatch } from '@ssandir/trypatch'

const quoteSchema = {
  type: 'object',
  properties: { price: { type: 'number' }, currency: { type: 'string' } },
  required: ['price', 'currency'],
  additionalProperties: false,
} as const satisfies JSONSchema
type Quote = FromSchema<typeof quoteSchema>

// Tool — cast execute input
const convertQuote = new Tool({
  name: 'convertQuote',
  description: 'Return the given quote converted to EUR',
  parameters: quoteSchema,
  execute: (input: unknown): Promise<Quote> => currencyClient.toEur(input as Quote),
})

// @trypatch — declare the return type, cast the callback result
class PricingService {
  @trypatch({
    aiInvestigation: {
      resultSchema: quoteSchema,
      investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
      resultTools: [convertQuote],
      onInvestigationResult: (result, { explanation }) => console.warn(`Recovered ${(result as Quote).price}: ${explanation}`),
    },
  })
  async getQuote (productId: string): Promise<Quote> { /* ... */ }
}
```

Use `as const satisfies JSONSchema` so `FromSchema<typeof quoteSchema>` stays precise.

</details>

---

## Providers

Every provider config takes the API key directly; resolve it however you like (env var, secret manager, etc.) before passing it in. `openai`, `claude` and `openai-compatible` are built on the [Vercel AI SDK](https://ai-sdk.dev), bundled internally, so its types and versions never show up in your code.

### OpenAI

`provider: 'openai'` calls OpenAI's Responses API with strict JSON Schema output.

```typescript
investigationProvider: {
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
}
```

Optional fields: `model` (default `gpt-5.5`), `baseURL`, `organization`, `project`, and `fetch`.

### Claude (Anthropic)

`provider: 'claude'` calls Anthropic's Messages API with JSON Schema output.

```typescript
investigationProvider: {
  provider: 'claude',
  apiKey: process.env.ANTHROPIC_API_KEY!,
}
```

Optional fields: `model` (default `claude-sonnet-5`), `baseURL` (without the `/v1` suffix), `apiVersion` (`anthropic-version` header, default `2023-06-01`), and `fetch`.

### OpenAI-compatible endpoints

`provider: 'openai-compatible'` works with anything that exposes an OpenAI-compatible Chat Completions API: Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, and many more.

```typescript
investigationProvider: {
  provider: 'openai-compatible',
  baseURL: 'http://localhost:11434/v1',
  model: 'llama3.3',
  supportsStructuredOutputs: true,
}
```

`baseURL` and `model` are required. Optional fields: `apiKey`, `headers`, `supportsStructuredOutputs`, and `fetch`.

Set `supportsStructuredOutputs: true` if the endpoint enforces JSON Schema output. When it's `false` (the default), the AI is only asked for JSON, trypatch validates the outcome afterwards, and the AI SDK logs a warning on every investigation.

### Cursor Cloud Agents

`provider: 'cursor'` starts a Cursor cloud agent and polls its run until it finishes. It doesn't support `investigationTools` or `maxToolIterations`, but it does support [`mcpServers`](#mcp-servers-give-the-ai-your-existing-tooling). A timeout or [abort](#cancellation-abort-signals) stops polling, but the remote agent keeps running.

```typescript
investigationProvider: {
  provider: 'cursor',
  apiKey: process.env.CURSOR_API_KEY!,
  repository: { url: 'https://github.com/acme/payments' },
}
```

Optional fields: `model`, `repository` (`url`, `startingRef`, `prUrl`), `baseURL`, `pollIntervalMs`, and `fetch`.

---

## Custom `fetch`: Proxying, Custom Auth, Retries

Every provider config accepts an optional `fetch`, used instead of the global one for every HTTP call that provider makes. It's the same pattern the Anthropic and OpenAI SDKs use — supply a function with `fetch`'s signature and do whatever you need before (or instead of) calling through to a real `fetch`: route through a proxy, inject a freshly refreshed token, add retries, log requests, etc.

<details>
<summary>Example</summary>

```typescript
class PricingService {
  @trypatch({
    aiInvestigation: {
      resultSchema: QuoteSchema,
      investigationProvider: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        fetch: async (url, init) => fetch(`https://my-proxy.internal/openai?target=${encodeURIComponent(String(url))}`, {
          ...init,
          headers: { ...init?.headers, 'X-Proxy-Token': await getProxyToken() },
        }),
      },
    },
  })
  async getQuote(productId: string): Promise<Quote> { /* ... */ }
}
```

</details>

Cursor's provider calls this for both the agent-creation and run-polling requests.

---

<details>
<summary>Decorator dialect compatibility</summary>

`@trypatch` works whether your project compiles with TypeScript's legacy `experimentalDecorators` (the default for NestJS, TypeORM, and similar frameworks) or with the standard stage-3 decorators TS 5 uses by default. No configuration needed — it detects which dialect is calling it at runtime.

With stage-3 decorators, TypeScript checks that the method returns `Promise<…>` of your `resultSchema` type. Legacy decorators don't see the method's return type, so that check can't happen there: declare decorated methods `async` and give them the schema's type yourself. Under both dialects, the decorated method always returns a Promise.

</details>
