# trypatch e2e

> **Vibecoded.** This folder was written with an AI assistant and hasn't been reviewed to the standards of the library itself. It exists to check that the published package works against a real provider and to show what an investigation actually receives. Don't treat it as example code.

## What it tests

One scenario, against Claude, using the packed `@ssandir/trypatch` tarball exactly as a consumer would install it.

A `ShippingQuoteClient.getQuote(order)` method calls a carrier API and parses the response with zod. The parser assumes `eta_days` is always an integer, because it always has been. For a Canary Islands destination the carrier answers with `eta_days: null` and a new `eta_range: { min, max }`, so the parse throws a `ZodError`.

`@trypatch` investigates with Claude. The model can call `getRecentCarrierCalls`, which reads an APM-style log of recent carrier calls; that's the only place the raw response (with `eta_range`) is visible. It should return a valid `Quote` built from that response.

On the way, two fake secrets (the carrier API key in the request URL, and the customer's email in the order) are redacted with `redactConfig`; the test checks neither reaches Anthropic.

## Running

Requires Node 22.12+ and an Anthropic API key.

```bash
cd e2e
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
npm test
```

`npm test` builds the library, packs it, reinstalls the tarball here, type-checks, and runs the test. Each run costs one investigation's worth of tokens (a few requests, since the model calls a tool). The test fails if the key is missing.

## Reading the output

Every run writes `output/claude-<timestamp>.json`, even when the test fails:

| Field | What it is |
| --- | --- |
| `outcome` | What `getQuote` returned (or threw) |
| `investigationResults` | What `onInvestigationResult` received, including the model's `explanation` |
| `servedRemote` | The body the stub actually returned for the failing call |
| `capturedContext` | The `InvestigationContext` trypatch built, captured through `getSignal` |
| `toolCalls` | Each `getRecentCarrierCalls` call: what the tool received (real values) and returned |
| `exchanges` | Every HTTP request to Anthropic and its response, with the API key header masked. This is exactly what the provider saw, after redaction |
| `logs` | Everything trypatch logged |
| `soft` | Checks that are recorded but don't fail the test |

The test also prints the system prompt, the first user message, the returned quote and the explanation.
