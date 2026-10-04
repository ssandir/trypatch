# trypatch

Standalone TypeScript library (Node 22.12+) that exposes a method decorator for wrapping function execution with error handling.

```bash
cd trypatch
npm install
npm run build
npm run type-check
npm run test
npm run lint
```

Or from the repo root with `--prefix`:

```bash
npm --prefix trypatch run <script>
```

Consumers can depend on it via a `file:` reference in their `package.json`:

## Testing

The AI SDK is ESM-only; `jest.config.cjs` lists it among the ESM dependencies that get compiled for Jest. Tests don't mock provider wire formats beyond one smoke test per provider in `aiInvestigation.spec.ts`: they `jest.mock` `createLanguageModel` and return a `MockLanguageModelV4` built with the helpers in `src/test/mockLanguageModel.ts`.

## e2e

`e2e/` is a vibecoded harness that runs real provider calls against the packed tarball; it has its own `AGENTS.md` and README, and its code is not a style reference for `src/`. It is not part of `npm test`, but root `npm run lint` covers it and needs `npm run e2e:setup` first.

## Type-checking

`tsc` does not reject `await` on non-Promise values; type-aware ESLint (`@typescript-eslint/await-thenable`) catches those, so `npm run lint` is part of type safety, not just style. The `type-check` script runs `tsc` only. A husky pre-commit hook (installed by `npm install` through the `prepare` script; config in `lint-staged.config.js`) runs `lint:fix` on staged files and `type-check` on the whole project.

## Logging

`Logger` with `verbosity: 'low'` only writes the first argument, so every `logger.*` call's first argument must be a complete message on its own: prefix it with `[ssandir/trypatch]`, put identifying details (server name, tool names) inline, and never end it with `:`. Error objects and extra detail go in later arguments.

## Decorator dialects

`@trypatch` supports both TC39 stage-3 decorators (TS 5 default) and TypeScript's legacy `experimentalDecorators` (NestJS/TypeORM's default), since a lot of real-world consumers are still on legacy. `trypatch.ts` detects which dialect called it at runtime by argument shape and dispatches to a matching implementation; see the comment on `trypatch()` there for details. `jest.config.cjs` runs `trypatch.spec.ts` twice — once compiled per dialect — to cover both runtime paths; this project's own `tsconfig.json` intentionally omits `experimentalDecorators` since the source is authored against stage-3.

On method failure, `@trypatch(...)` can call an external provider to produce the value the method should have returned. `resultSchema` is the method's return type, not a diagnosis: the stage-3 decorator type requires `Return extends Promise<SchemaInfer<S>>`. It must be a `Promise` because the wrapper always returns one (recovering a value is async) and a decorator can't change a member's declared type. Legacy decorators can't check the return type at all. The prompts in `buildPrompt.ts` and the outcome variant descriptions tell the model that its outcome replaces the failed call. The provider's structured output must match one of three outcomes, described to it as a JSON Schema built from `resultSchema`/`customErrors`/`resultTools`: an explicit `result` matching `resultSchema` (returned as the method's value), a call into one of `resultTools` (trypatch runs it and returns its value), or a thrown `customErrors` entry. Both value outcomes carry a required `explanation` (why the call failed, why the value is correct), logged with `logger.info` as the second argument (so only shown at `verbosity: 'high'`) and passed as `onInvestigationResult(result, { explanation })`. Set `allowDirectResultCreation: false` to drop the explicit-`result` outcome from that schema, forcing every outcome through a `resultTool` or `customErrors` entry; `buildInvestigationResultSchema` throws if that leaves no possible outcome at all.

An investigation that ends without a value is logged in `runInvestigation`'s `catch (investigationError)` block, and the method rethrows its original error. It never resolves `undefined`, since a method typed `Promise<Quote>` must not hand callers something that isn't a `Quote`. Only three errors replace the original: the caller's abort reason, `TrypatchFatalError`, and a `customErrors` entry with `propagate: true`.

Three more outcomes exist to steer the AI away from fabricating a result when nothing fits, each behind its own boolean (all default `true`, additive to the outcomes above; set to `false` to remove that escape hatch) and each throwing its own error class: `allowCannotDetermine` (there isn't enough information to work out a correct return value → `TrypatchCannotDetermineError`), `allowUncertainResult` (a candidate value exists but confidence is too low to return it → `TrypatchUncertainResultError`), and `allowNoApplicableOutcome` (none of the configured `result`/`resultTools`/`customErrors` fit the situation → `TrypatchNoApplicableOutcomeError`). The AI supplies a `reason` string that becomes the thrown error's message. Like `customErrors` without `propagate`, these are logged and the method rethrows its original error; they have no `propagate` option of their own.

`getSignal` on `TryPatchOptions` is a function `(ctx) => AbortSignal | undefined`, since a call's signal doesn't exist yet at decoration time. `runInvestigation` resolves it once per call (no per-dialect code; both dialects end up there) and passes it to `investigateError`. `src/abort/withDeadline.ts` combines it with our own timeouts (the optional base `timeoutMs` option, no default, covering the whole investigation for both AI (provider call and the result tool it picks) and custom `investigate`; a tool's `timeoutMs` in `Tool.call`) and stops waiting for work that ignores the signal. Whoever controls a signal handles its abort: our timeout becomes `TrypatchTimeoutError`, logged like any investigation failure before the method rethrows its original error; the caller's abort is rethrown as its own reason by `signal?.throwIfAborted()` at the top of `runInvestigation`'s `catch`, ahead of every other check. Custom `investigate`, investigation tools, MCP connects and tools, and result tools all receive the signal; result tools get the same combined signal, inside `timeoutMs`.

`customInvestigation.investigate` bypasses the AI provider flow entirely with a user-supplied handler. Its own `customErrors` is a distinct, lighter-weight list of `{ errorConstructor }` entries: since `investigate` throws these directly rather than an AI constructing them from JSON, no `errorParameterSchema`/`description` is needed, and matching one always propagates.

| Provider | Notes |
| -------- | ----- |
| `openai` | AI SDK (`@ai-sdk/openai`, Responses API) with strict JSON Schema output |
| `claude` | AI SDK (`@ai-sdk/anthropic`, Messages API) with JSON Schema output |
| `openai-compatible` | AI SDK (`@ai-sdk/openai-compatible`) for any OpenAI-compatible endpoint (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...); set `supportsStructuredOutputs` if the endpoint enforces JSON Schema |
| `cursor` | Raw `fetch` against the Cloud Agents API; polls run until finished. Does not use `investigationTools`, but supports `mcpServers` |

All providers except `cursor` go through `providers/languageModel/`, which maps our own provider configs onto [AI SDK](https://ai-sdk.dev) models and runs a single `generateText` call. No AI SDK type is part of the public API, so AI SDK major upgrades stay internal. That call runs the tool loop: the model may call `investigationTools` (executed via `Tool.call` with `toolContext`) over up to `investigationBehavior.maxToolIterations` turns (default 20) before returning its outcome, and `timeoutMs` covers the whole loop. Tool failures are sent back to the model rather than failing the investigation. With `redactConfig`, tool input is restored and tool output redacted, so tools see real values and the provider only sees placeholders. `resultTools` are not part of this loop: they stay outcome variants that trypatch executes after the model picks one.

`mcpServers` (user-defined `http`/`sse`/`stdio` servers, auth via `headers` — static or a function resolved per investigation — or `env`) adds MCP tools to that same loop. `providers/languageModel/mcp.ts` connects with `@ai-sdk/mcp` once per investigation, exposes each tool as `<server>__<tool>` (filtered by the optional `allowedTools`), wraps it like `investigationTools` (redaction, deadline) and closes every client in a `finally`. We connect locally rather than using OpenAI/Anthropic hosted MCP so internal and stdio servers work and redaction/limits apply; README explains the trade-off. A server that fails to connect (or whose `headers` function throws) is logged with `warn` and skipped, never failing the investigation; the model isn't told, and the escape outcomes cover investigations that can't conclude without it. Invalid config (`validateMcpServers`: names, duplicate names, credentials in URLs, `allowedTools` with `cursor`) throws `TrypatchConfigError`. `cursor` passes servers through to its Create Agent body's `mcpServers` instead.

Each provider config takes `apiKey: string` directly (optional for `openai-compatible`) — resolving it (env var, secret manager, etc.) is the consumer's job — plus an optional `fetch` override (same pattern as the Anthropic/OpenAI SDKs) used instead of the global one for every HTTP call that provider makes.

Optional `redactConfig` (`VaultOptions`) on AI investigation options redacts prompts with [flare-redact](https://www.npmjs.com/package/flare-redact) before they reach the provider and restores placeholders in the response.

Example:

```typescript
import { z } from 'zod'
import { trypatch } from '@ssandir/trypatch'

const QuoteSchema = z.object({
  price: z.number(),
  currency: z.string(),
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
      redactConfig: {
        terms: ['super-secret-value-from-env'],
      },
      onInvestigationResult: (quote, { explanation }) => console.warn('getQuote recovered', quote, explanation),
    },
  })
  async getQuote (productId: string): Promise<Quote> { /* ... */ }
}
```
