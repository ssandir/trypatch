# trypatch

Standalone TypeScript library (Node 22+) that exposes a method decorator for wrapping function execution with error handling.

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

`tsc` does not reject `await` on non-Promise values. The `type-check` script runs both `tsc` and type-aware ESLint (`@typescript-eslint/await-thenable`) on `src/`.

## Decorator dialects

`@trypatch` supports both TC39 stage-3 decorators (TS 5 default) and TypeScript's legacy `experimentalDecorators` (NestJS/TypeORM's default), since a lot of real-world consumers are still on legacy. `trypatch.ts` detects which dialect called it at runtime by argument shape and dispatches to a matching implementation; see the comment on `trypatch()` there for details. `jest.config.cjs` runs `trypatch.spec.ts` twice — once compiled per dialect — to cover both runtime paths; this project's own `tsconfig.json` intentionally omits `experimentalDecorators` since the source is authored against stage-3.

On method failure, `@trypatch(...)` can call an external provider to analyze the error. The provider's structured output must match one of three outcomes, described to it as a JSON Schema built from `resultSchema`/`customErrors`/`resultTools`: an explicit `result` matching `resultSchema`, a call into one of `resultTools`, or a thrown `customErrors` entry. Set `allowDirectResultCreation: false` to drop the explicit-`result` outcome from that schema, forcing every outcome through a `resultTool` or `customErrors` entry; `buildInvestigationResultSchema` throws if that leaves no possible outcome at all. By default a thrown `customErrors` entry is logged and swallowed like any other investigation failure; set `propagate: true` on that entry to have `runInvestigation` rethrow it instead — same treatment as `TrypatchFatalError`.

Three more outcomes exist to steer the AI away from fabricating a result when nothing fits, each behind its own boolean (all default `true`, additive to the outcomes above; set to `false` to remove that escape hatch) and each throwing its own error class: `allowCannotDetermine` (there isn't enough information to identify a cause at all → `TrypatchCannotDetermineError`), `allowUncertainResult` (a candidate result exists but confidence is too low to state as fact → `TrypatchUncertainResultError`), and `allowNoApplicableOutcome` (none of the configured `result`/`resultTools`/`customErrors` fit the situation → `TrypatchNoApplicableOutcomeError`). The AI supplies a `reason` string that becomes the thrown error's message. Like `customErrors`, these are logged and swallowed by default in `runInvestigation`'s `catch (investigationError)` block; they have no `propagate` option of their own.

`customInvestigation.investigate` bypasses the AI provider flow entirely with a user-supplied handler. Its own `customErrors` is a distinct, lighter-weight list of `{ errorConstructor }` entries: since `investigate` throws these directly rather than an AI constructing them from JSON, no `errorParameterSchema`/`description` is needed, and matching one always propagates.

| Provider | Notes |
| -------- | ----- |
| `openai` | AI SDK (`@ai-sdk/openai`, Responses API) with strict JSON Schema output |
| `claude` | AI SDK (`@ai-sdk/anthropic`, Messages API) with JSON Schema output |
| `openai-compatible` | AI SDK (`@ai-sdk/openai-compatible`) for any OpenAI-compatible endpoint (Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, ...); set `supportsStructuredOutputs` if the endpoint enforces JSON Schema |
| `cursor` | Raw `fetch` against the Cloud Agents API; polls run until finished. Does not use `investigationTools` |

All providers except `cursor` go through `providers/languageModel/`, which maps our own provider configs onto [AI SDK](https://ai-sdk.dev) models and runs a single `generateText` call. No AI SDK type is part of the public API, so AI SDK major upgrades stay internal. That call runs the tool loop: the model may call `investigationTools` (executed via `Tool.call` with `toolContext`) over up to `investigationBehavior.maxToolIterations` turns (default 20) before returning its outcome, and `timeoutMs` covers the whole loop. Tool failures are sent back to the model rather than failing the investigation. With `redactConfig`, tool input is restored and tool output redacted, so tools see real values and the provider only sees placeholders. `resultTools` are not part of this loop: they stay outcome variants that trypatch executes after the model picks one.

Each provider config takes `apiKey: string` directly (optional for `openai-compatible`) — resolving it (env var, secret manager, etc.) is the consumer's job — plus an optional `fetch` override (same pattern as the Anthropic/OpenAI SDKs) used instead of the global one for every HTTP call that provider makes.

Optional `redactConfig` (`VaultOptions`) on AI investigation options redacts prompts with [flare-redact](https://www.npmjs.com/package/flare-redact) before they reach the provider and restores placeholders in the response.

Example:

```typescript
import { z } from 'zod'
import { trypatch } from 'ssandir/trypatch'

const schema = z.object({
  rootCause: z.string(),
  retryable: z.boolean(),
})

class Service {
  @trypatch({
    resultSchema: schema,
    investigationProvider: {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
    },
    redactConfig: {
      terms: ['super-secret-value-from-env'],
    },
    onInvestigationResult: (result) => console.warn(result),
  })
  async run () { /* ... */ }
}
```
