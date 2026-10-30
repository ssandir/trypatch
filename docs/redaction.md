---
title: Redaction
---

# Redaction

API keys, tokens and PII are redacted before they leave your process, on by default. {@linkcode AiInvestigationOptions.redactConfig | redactConfig} adds your own `terms` or tunes [flare-redact](https://www.npmjs.com/package/flare-redact)'s detectors, and `redactConfig: false` turns redaction off.

{@includeCode ../examples/redaction.ts#redaction}

## How it works

1. Before the prompt goes to the provider, trypatch replaces secrets found by flare-redact's default detectors (API keys, bearer tokens, emails, card numbers, ...) and your `terms` with placeholders.
2. The provider investigates the redacted data.
3. When the AI calls an investigation or MCP tool, placeholders in its input are restored before the tool runs, and the tool's output is redacted before it goes back.
4. Placeholders in the response are restored locally before the value is returned.

Detected and listed secrets never leave your infrastructure.

## What isn't redacted

Redaction only covers what goes to the provider:

- Callbacks get raw values: `ctx.error` and `ctx.args` as they were, and the AI's `explanation` with placeholders restored. Scrub them before they reach a third party.
- Tool and MCP tool descriptions are sent as written.
- With `cursor`, MCP traffic runs inside Cursor, out of redaction's reach. See [MCP servers](./mcp-servers.md).
- To keep values out of the prompt entirely, use {@linkcode InvestigationBehavior.sanitizeArgs | sanitizeArgs}.
