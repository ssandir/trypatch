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

## Type-checking

`tsc` does not reject `await` on non-Promise values; type-aware ESLint (`@typescript-eslint/await-thenable`) catches those, so `npm run lint` is part of type safety, not just style. The `type-check` script runs `tsc` only. A husky pre-commit hook (installed by `npm install` through the `prepare` script; config in `lint-staged.config.js`) runs `lint:fix` on staged files and `type-check` on the whole project.

## Logging

`Logger` with `verbosity: 'low'` only writes the first argument, so every `logger.*` call's first argument must be a complete message on its own: prefix it with `[ssandir/trypatch]`, put identifying details (server name, tool names) inline, and never end it with `:`. Error objects and extra detail go in later arguments.

## Decorator dialects

`@trypatch` supports both TC39 stage-3 decorators (TS 5 default) and TypeScript's legacy `experimentalDecorators` (NestJS/TypeORM's default), since a lot of real-world consumers are still on legacy. `trypatch.ts` detects which dialect called it at runtime by argument shape and dispatches to a matching implementation; see the comment on `trypatch()` there for details. `jest.config.cjs` runs `trypatch.spec.ts` twice — once compiled per dialect — to cover both runtime paths; this project's own `tsconfig.json` intentionally omits `experimentalDecorators` since the source is authored against stage-3.

On method failure, `@trypatch(...)` can call an external provider to analyze the error. The provider's structured output must match one of three outcomes, described to it as a JSON Schema built from `resultSchema`/`customErrors`/`resultTools`: an explicit `result` matching `resultSchema`, a call into one of `resultTools`, or a thrown `customErrors` entry. Set `allowDirectResultCreation: false` to drop the explicit-`result` outcome from that schema, forcing every outcome through a `resultTool` or `customErrors` entry; `buildInvestigationResultSchema` throws if that leaves no possible outcome at all. By default a thrown `customErrors` entry is logged and swallowed like any other investigation failure; set `propagate: true` on that entry to have `runInvestigation` rethrow it instead — same treatment as `TrypatchFatalError`.

Three more outcomes exist to steer the AI away from fabricating a result when nothing fits, each behind its own boolean (all default `true`, additive to the outcomes above; set to `false` to remove that escape hatch) and each throwing its own error class: `allowCannotDetermine` (there isn't enough information to identify a cause at all → `TrypatchCannotDetermineError`), `allowUncertainResult` (a candidate result exists but confidence is too low to state as fact → `TrypatchUncertainResultError`), and `allowNoApplicableOutcome` (none of the configured `result`/`resultTools`/`customErrors` fit the situation → `TrypatchNoApplicableOutcomeError`). The AI supplies a `reason` string that becomes the thrown error's message. Like `customErrors`, these are logged and swallowed by default in `runInvestigation`'s `catch (investigationError)` block; they have no `propagate` option of their own.

`getSignal` on `TryPatchOptions` is a function `(ctx) => AbortSignal | undefined`, since a call's signal doesn't exist yet at decoration time. `runInvestigation` resolves it once per call (no per-dialect code; both dialects end up there) and passes it to `investigateError`. `src/abort/withDeadline.ts` combines it with our own timeouts (`investigationBehavior.timeoutMs` in both providers, a tool's `timeoutMs` in `Tool.call`) and stops waiting for work that ignores the signal. Whoever controls a signal handles its abort: our timeout becomes `TrypatchTimeoutError`, logged and swallowed like any investigation failure; the caller's abort is rethrown as its own reason by `signal?.throwIfAborted()` at the top of `runInvestigation`'s `catch`, ahead of every other check. Custom `investigate`, investigation tools, MCP connects and tools, and result tools all receive the signal; result tools get only the caller's signal, outside `timeoutMs`.

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

const schema = z.object({
  rootCause: z.string(),
  retryable: z.boolean(),
})

class Service {
  @trypatch({
    aiInvestigation: {
      resultSchema: schema,
      investigationProvider: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
      },
      redactConfig: {
        terms: ['super-secret-value-from-env'],
      },
      onInvestigationResult: (result) => console.warn(result),
    },
  })
  async run () { /* ... */ }
}
```
