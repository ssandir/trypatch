---
title: Providers
---

# Providers

{@link AiInvestigationOptions.investigationProvider | `investigationProvider`} picks the AI that investigates. Every provider config takes its API key directly; resolve it however you like (env var, secret manager, ...).

## OpenAI

{@link OpenAiInvestigationConfig | `provider: 'openai'`} calls OpenAI's Responses API with strict JSON Schema output.

{@includeCode ../examples/providers.ts#openai}

## Claude (Anthropic)

{@link ClaudeInvestigationConfig | `provider: 'claude'`} calls Anthropic's Messages API with JSON Schema output.

{@includeCode ../examples/providers.ts#claude}

## OpenAI-compatible endpoints

{@link OpenAiCompatibleInvestigationConfig | `provider: 'openai-compatible'`} works with anything that exposes an OpenAI-compatible Chat Completions API: Gemini, Mistral, Groq, Ollama, OpenRouter, vLLM, and more.

{@includeCode ../examples/providers.ts#openai-compatible}

Set `supportsStructuredOutputs: true` if the endpoint enforces JSON Schema output. Without it, the AI is only asked for JSON, trypatch validates the outcome afterwards, and a warning is printed to the console on every investigation.

## Cursor Cloud Agents

{@link CursorInvestigationConfig | `provider: 'cursor'`} starts a Cursor cloud agent and polls its run until it finishes.

{@includeCode ../examples/providers.ts#cursor}

- It doesn't run `investigationTools` and has no `maxToolIterations` (the Cursor API has no turn limit), but it supports [MCP servers](./mcp-servers.md).
- A timeout or [abort](./cancellation.md) stops polling and cancels the remote run, best effort.

## Custom `fetch`

Every provider config accepts a `fetch`, used instead of the global one for every HTTP call that provider makes, the same pattern the Anthropic and OpenAI SDKs use. Wrap a real `fetch` to route through a proxy, inject a freshly refreshed token, add retries or log requests:

{@includeCode ../examples/providers.ts#custom-fetch}
