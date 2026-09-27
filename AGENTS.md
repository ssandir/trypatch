# trypatch

Standalone TypeScript library that exposes a method decorator for wrapping function execution with error handling.

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

## Type-checking

`tsc` does not reject `await` on non-Promise values. The `type-check` script runs both `tsc` and type-aware ESLint (`@typescript-eslint/await-thenable`) on `src/`.

## Decorator dialects

`@trypatch` supports both TC39 stage-3 decorators (TS 5 default) and TypeScript's legacy `experimentalDecorators` (NestJS/TypeORM's default), since a lot of real-world consumers are still on legacy. `trypatch.ts` detects which dialect called it at runtime by argument shape and dispatches to a matching implementation; see the comment on `trypatch()` there for details. `jest.config.cjs` runs `trypatch.spec.ts` twice — once compiled per dialect — to cover both runtime paths; this project's own `tsconfig.json` intentionally omits `experimentalDecorators` since the source is authored against stage-3.

On method failure, `@trypatch(...)` can call an external provider to analyze the error. The provider's structured output must match one of three outcomes, described to it as a JSON Schema built from `resultSchema`/`customErrors`/`resultTools`: an explicit `result` matching `resultSchema`, a call into one of `resultTools`, or a thrown `customErrors` entry. Set `allowDirectResultCreation: false` to drop the explicit-`result` outcome from that schema, forcing every outcome through a `resultTool` or `customErrors` entry; `buildInvestigationResultSchema` throws if that leaves no possible outcome at all.

| Provider | Notes |
| -------- | ----- |
| `openai` | Uses Chat Completions with strict JSON Schema output |
| `cursor` | Uses Cloud Agents API; polls run until finished |
| `claude` | Uses Anthropic Messages API with JSON Schema output |

Each provider config takes `apiKey: string` directly — resolving it (env var, secret manager, etc.) is the consumer's job — plus an optional `fetch` override (same pattern as the Anthropic/OpenAI SDKs) used instead of the global one for every HTTP call that provider makes.

Optional `redactConfig` (`VaultOptions`) on AI investigation options redacts prompts with [flare-redact](https://www.npmjs.com/package/flare-redact) before they reach the provider and restores placeholders in the response.

Example:

```typescript
import { z } from 'zod'
import { trypatch, Providers } from 'ssandir/trypatch'

const schema = z.object({
  rootCause: z.string(),
  retryable: z.boolean(),
})

class Service {
  @trypatch({
    resultSchema: schema,
    investigationProvider: {
      provider: Providers.OPENAI,
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
