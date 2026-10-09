# trypatch e2e

> **Vibecoded.** This folder was written with an AI assistant and hasn't been reviewed to the standards of the library itself. It exists to check that the published package works against a real provider and to show what an investigation actually receives. Don't treat it as example code.

## What it tests

Two scenarios, against Claude, using the packed `@ssandir/trypatch` tarball exactly as a consumer would install it.

### Changed response format (`claude.e2e.ts`)

A `ShippingQuoteClient.getQuote(order)` method calls a carrier API and parses the response with zod. The parser assumes `eta_days` is always an integer, because it always has been. For a Canary Islands destination the carrier answers with `eta_days: null` and a new `eta_range: { min, max }`, so the parse throws a `ZodError`.

`@trypatch` investigates with Claude. The model can call `getRecentCarrierCalls`, which reads an APM-style log of recent carrier calls; that's the only place the raw response (with `eta_range`) is visible. It should return a valid `Quote` built from that response.

On the way, three fake secrets have to be redacted before they reach Anthropic: the carrier API key in the request URL (listed in `redactConfig.terms`), and, caught only by flare-redact's default detectors, the customer's email in the order and the bearer access token in the thrown `CarrierError`'s request headers. That error wraps the `ZodError` as its `cause`, so the test also checks the error's properties and cause reach the prompt.

### Transient failure with `Retry-After` (`claude-retry-after.e2e.ts`)

The carrier stub is throttled: quote requests answer `503` with a `Retry-After: 15` header until 15 seconds have passed, and a retry before then gets `503` again. The thrown `CarrierError` carries the response, headers included, so the model sees `retry-after` in the prompt.

The model has no investigation tools of its own, only the built-in `trypatch_builtin_wait` that trypatch adds by default, and one result tool, `retryQuoteRequest`, that replays the failed request. `allowDirectResultCreation` is off, so the only way to a `Quote` is to wait out `Retry-After` and then pick the retry. A served quote proves the wait was long enough; whether the model waited exactly once and for the full `Retry-After` goes under `soft`.

## Running

Requires Node 22.12+ and an Anthropic API key.

```bash
cd e2e
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm test
```

`npm test` builds the library, packs it, reinstalls the tarball here, type-checks, and runs the tests. Each run costs two investigations' worth of tokens (a few requests each, since the model calls tools). The retry scenario also spends at least 15 seconds waiting. The run fails if the key is missing.

To run a single test:

```bash
# Changed response format (claude.e2e.ts)
npm test -- claude

# Transient failure with Retry-After (claude-retry-after.e2e.ts)
npm test -- claude-retry-after
```

## Running in CI

Comment `[e2e]` on a pull request. Only the repository owner can trigger it, since the job runs the PR's code with the API key and that code can read it. `.github/workflows/e2e.yml` reacts 👀 to the comment, tests the PR's head commit as it was at that moment, and reports an `e2e` status on that commit (then 🚀 or 😕 on the comment). Reports are uploaded as the `e2e-reports` artifact, also on failure.

The key comes from the `ANTHROPIC_API_KEY` secret of the `e2e` GitHub environment. Like every `issue_comment` workflow, it only runs once the workflow file is on the default branch.

## Reading the output

Every run writes `output/claude-<timestamp>.json` and `output/claude-retry-after-<timestamp>.json`, even when a test fails. The first has these fields:

| Field | What it is |
| --- | --- |
| `outcome` | What `getQuote` returned (or threw) |
| `investigationEnds` | The outcomes `onAiInvestigationEnd` received, including the model's `explanation` |
| `servedRemote` | The body the stub actually returned for the failing call |
| `capturedContext` | The `InvestigationContext` trypatch built, captured through `getSignal` |
| `toolCalls` | Each `getRecentCarrierCalls` call: what the tool received (real values) and returned |
| `exchanges` | Every HTTP request to Anthropic and its response, with the API key header masked. This is exactly what the provider saw, after redaction |
| `logs` | Everything trypatch logged |
| `soft` | Checks that are recorded but don't fail the test |

The retry report has `outcome`, `investigationEnds`, `exchanges`, `logs` and `soft` as well, plus `waitCalls` (each `trypatch_builtin_wait` call the model made), `retryCalls` and `apmLog` (every carrier response, so the 503 and the successful retry can be compared by time).

The first test also prints the system prompt, the first user message, the returned quote and the explanation.
