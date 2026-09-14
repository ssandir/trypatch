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

On method failure, `@trypatch(...)` can call an external provider to analyze the error and return JSON matching `resultSchema`.

| Provider | Auth env var | Notes |
| -------- | ------------ | ----- |
| `openai` | `OPENAI_API_KEY` | Uses Chat Completions with strict JSON Schema output |
| `cursor` | `CURSOR_API_KEY` | Uses Cloud Agents API; polls run until finished |

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
      auth: { kind: 'env', variable: 'OPENAI_API_KEY' },
    },
    redactConfig: {
      terms: ['super-secret-value-from-env'],
    },
    onInvestigationResult: (result) => console.warn(result),
  })
  async run () { /* ... */ }
}
```
