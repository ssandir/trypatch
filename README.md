# ssandir/trypatch

**Production-ready error investigation and automatic resolution.** When your functions fail, `trypatch` investigates the error in your production environment and either recovers it with custom tools or returns a structured diagnosis—all while keeping sensitive data local.

## What You Get

- 🔍 **On-the-fly Investigation**: When a method fails, AI analyzes the error context and generates actionable results
- 🛡️ **Schema-Based Guarantees**: All investigation results conform to a schema you define (Zod or JSON Schema)
- 🔐 **Automatic Credential Censoring**: Sensitive data is redacted before leaving your instance; placeholders are restored in responses
- 🔧 **Tool-Based Recovery**: Provide tools (e.g., `executeExternalApiCall`,`retryWithExponentialBackoff`, `fetchFromBackupService`) that trypatch can execute to resolve transient failures
- 🤖 **Multiple Providers**: OpenAI, Claude (Anthropic), any OpenAI-compatible endpoint (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...), or Cursor Cloud Agents for investigation logic

Requires Node.js 22 or later.

---

## Quick Start: Schema-Based Error Handling

Define what a resolved error should look like, and `@trypatch` ensures you always get that shape:

```typescript
import { z } from 'zod'
import { trypatch } from 'ssandir/trypatch'

const ResolutionSchema = z.object({
  rootCause: z.string().describe('Why the error occurred'),
  retryable: z.boolean().describe('Can this error be retried?'),
  suggestedAction: z.string().describe('What to do next'),
})

class PaymentService {
  @trypatch({
    resultSchema: ResolutionSchema,
    investigationProvider: {
      provider: 'openai',
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
import { trypatch } from 'ssandir/trypatch'

class DatabaseService {
  @trypatch({
    resultSchema: ErrorResolutionSchema,
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
4. When the AI calls an investigation tool, placeholders in its input are restored before the tool runs, and the tool's output is redacted before it goes back to the AI
5. Response placeholders are restored locally before returning
6. **Original secrets never leave your infrastructure**

---

## Tool-Based Recovery: Resolve Errors Automatically

Provide tools that trypatch can invoke to retry or recover from transient failures:

```typescript
import { Tool, trypatch } from 'ssandir/trypatch'
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
      provider: 'claude',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    // Tools the AI can call during investigation
    investigationTools: [retryTool],
  })
  async fetchData(endpoint: string) {
    // If this fails, Claude investigates and may invoke retryWithBackoff
    const response = await fetch(`https://api.example.com${endpoint}`)
    if (!response.ok) throw new Error('API returned ' + response.status)
    return response.json()
  }
}
```

The AI can call investigation tools over several turns: it calls a tool, reads the result, keeps investigating (possibly calling more tools), and then returns its outcome.

- `investigationBehavior.maxToolIterations` caps the number of tool turns (default 20)
- `investigationBehavior.timeoutMs` covers the whole investigation, including every tool turn; a tool still running at the deadline is abandoned
- `toolContext` is passed to every tool's `execute` as its second argument
- If a tool throws, the error is sent back to the AI so it can try something else, instead of failing the investigation

Investigation tools work with `openai`, `claude` and `openai-compatible`. The `cursor` provider ignores them, because Cursor's cloud agent runs its own tools remotely; use [`mcpServers`](#mcp-servers-give-the-ai-your-existing-tooling) to give it tools.

**Use cases:**
- **Volatile APIs**: `@trypatch` detects transient timeouts and retries automatically
- **Database connection pools**: Tools can wait for a connection to become available
- **Fallback services**: Tools can switch to a backup endpoint
- **Rate limiting**: Tools can apply backoff and retry intelligently

---

## MCP Servers: Give the AI Your Existing Tooling

`mcpServers` connects the investigation to [MCP](https://modelcontextprotocol.io) servers, and the AI can call their tools the same way it calls `investigationTools`. You define the servers; trypatch ships no presets.

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

- **Tool names:** the AI sees each tool as `<server name>__<tool name>` (`grafana__query_logs`), so two servers can't collide. Server names may only contain letters, digits, `_` and `-`.
- **Auth:** static `headers`, or a `headers` function that is called once per investigation (short-lived tokens, secret managers, client-credentials OAuth where you fetch the token yourself). Stdio servers get secrets through `env`. Interactive OAuth isn't supported: nobody is around to complete a browser login when an error fires on a server.
- **Recommended: read-only tools.** The AI decides which tools to call, and MCP servers often expose tools that change things (`delete_*`, `create_*`). Narrow each server with `allowedTools`. trypatch doesn't enforce this; which servers and tools to expose is your call.
- **Connection lifetime:** servers are connected when an investigation starts and closed when it ends. For stdio that means starting a new process on every investigated failure.
- **Unavailable servers don't fail the investigation.** A server that refuses to connect (or whose `headers` function throws) is logged as a warning and skipped. The AI investigates with the tools it has, and can fall back to one of the [fallback outcomes](#fallback-outcomes-avoiding-fabricated-results) if they aren't enough.
- MCP tools share `maxToolIterations`, `timeoutMs` (which also covers connecting) and `redactConfig` with `investigationTools`: the AI only sees redacted values, and MCP tool output is redacted before it reaches the provider. Tool descriptions are sent unredacted.

**Why trypatch connects to MCP servers itself.** OpenAI and Anthropic can also connect to MCP servers from their own cloud. trypatch deliberately connects locally for `openai`, `claude` and `openai-compatible`:

- **Internal servers work.** Hosted MCP only reaches servers on the public internet. The servers most useful for investigating errors (internal Grafana, databases, internal APIs) usually aren't.
- **stdio works.** Hosted MCP only supports remote servers.
- **Redaction applies.** With hosted MCP, tool calls go directly between the provider and the server, where `redactConfig` can't see them. Your MCP credentials would also have to be sent to the provider.
- **Limits apply.** Hosted tool calls happen inside a single API call, out of reach of `maxToolIterations` and the investigation deadline.
- **One behaviour everywhere.** `openai-compatible` has no hosted MCP, and Anthropic's connector only takes a single bearer token.
- **Failures are handled.** An unreachable server is skipped with a warning instead of failing the provider call.

**Cursor** is the exception: its Cloud Agents API runs MCP itself, so trypatch passes the servers through. Stdio servers run inside Cursor's cloud VM (`cwd` and `fetch` are ignored), and `headers`/`env` are sent to Cursor, which stores them encrypted and deletes them with the agent. `redactConfig` doesn't cover MCP traffic there, `allowedTools` isn't supported (setting it throws a `TrypatchConfigError`), and a server Cursor can't reach is handled by Cursor, not reported by trypatch.

---

## Fallback Outcomes: Avoiding Fabricated Results

Besides returning a `result`, calling a `resultTool`, or throwing a `customErrors` entry, the AI can report that it has nothing good to offer — instead of guessing. Three booleans control this, all defaulting to `true`:

- `allowCannotDetermine` — not enough information to identify a cause at all → throws `TrypatchCannotDetermineError`
- `allowUncertainResult` — a candidate answer exists but confidence is too low to state as fact → throws `TrypatchUncertainResultError`
- `allowNoApplicableOutcome` — none of the configured `result`/`resultTools`/`customErrors` fit the situation → throws `TrypatchNoApplicableOutcomeError`

The AI supplies a `reason` string, which becomes the thrown error's message. Like `customErrors`, these are logged and swallowed. Set the corresponding boolean to `false` to remove that escape hatch.

---

## JSON Schema and TypeScript

JSON Schema tool parameters and `@trypatch` result schemas map to `unknown`, not `FromSchema<T>`. Resolving
`FromSchema` through generic `Tool` / `@trypatch` types triggers TS2589 (excessively deep instantiation).
Runtime validation still runs (Ajv for tools; provider parsing for results). **Zod schemas infer types normally.**

For JSON Schema, define the shape locally and cast in handlers:

```typescript
import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { Tool, trypatch } from 'ssandir/trypatch'

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
    investigationProvider: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
    onInvestigationResult: (result) => console.warn((result as Result).rootCause),
  })
  async run (): Promise<Result> { /* ... */ }
}
```

Use `as const satisfies JSONSchema` so `FromSchema<typeof schema>` stays precise.

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

`provider: 'cursor'` starts a Cursor cloud agent and polls its run until it finishes. It doesn't support `investigationTools` or `maxToolIterations`, but it does support [`mcpServers`](#mcp-servers-give-the-ai-your-existing-tooling).

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

```typescript
class Service {
  @trypatch({
    resultSchema: ResolutionSchema,
    investigationProvider: {
      provider: 'openai',
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

---

<details>
<summary>Decorator dialect compatibility</summary>

`@trypatch` works whether your project compiles with TypeScript's legacy `experimentalDecorators` (the default for NestJS, TypeORM, and similar frameworks) or with the standard stage-3 decorators TS 5 uses by default. No configuration needed — it detects which dialect is calling it at runtime.

</details>
