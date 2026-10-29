---
title: MCP servers
---

# MCP servers

{@link AiInvestigationOptions.mcpServers | `mcpServers`} connects the investigation to [MCP](https://modelcontextprotocol.io) servers, and the AI calls their tools like `investigationTools`. You define the servers; trypatch ships no presets.

{@includeCode ../examples/mcp-servers.ts#mcp-servers}

## Behavior

- **Recommended: read-only tools.** The AI decides which tools to call, and MCP servers often expose tools that change things (`delete_*`, `create_*`). Narrow each server with `allowedTools`; trypatch doesn't enforce it.
- **Auth** goes in {@link McpRemoteServerConfig.headers | `headers`} (static, or a function for short-lived tokens or client-credentials OAuth) or a stdio server's `env`. Interactive OAuth isn't supported: nobody is around to complete a browser login when an error fires on a server.
- **Connection lifetime:** servers connect when an investigation starts and close when it ends, so a stdio server is a new process per investigated failure.
- **Unavailable servers don't fail the investigation.** A server that won't connect, or whose `headers` function throws, is logged as a warning and skipped. The AI works with the tools it has, and can pick a fallback outcome if they aren't enough.
- MCP tools share `maxToolIterations`, `timeoutMs` (which also covers connecting) and redaction with `investigationTools`. Tool descriptions are sent unredacted.
- Invalid server config (bad or duplicate names, credentials in a URL) throws {@link TrypatchConfigError} when the decorator is applied.

## Why trypatch connects itself

OpenAI and Anthropic can connect to MCP servers from their own cloud. For `openai`, `claude` and `openai-compatible`, trypatch connects locally instead:

- **Internal servers work.** Hosted MCP only reaches the public internet, and the servers most useful for investigating errors (internal Grafana, databases, internal APIs) usually aren't on it.
- **stdio works.** Hosted MCP only supports remote servers.
- **Redaction applies.** Hosted tool calls go straight between the provider and the server, out of `redactConfig`'s reach, and your MCP credentials would go to the provider.
- **Limits apply.** Hosted tool calls happen inside one API call, out of reach of `maxToolIterations` and the deadline.
- **One behavior everywhere.** `openai-compatible` has no hosted MCP, and Anthropic's connector only takes a single bearer token.

## Cursor

Cursor's Cloud Agents API runs MCP itself, so trypatch passes the servers through:

- Stdio servers run inside Cursor's cloud VM, so `cwd` and `fetch` are ignored.
- `headers` and `env` are sent to Cursor, which stores them encrypted and deletes them with the agent.
- `redactConfig` doesn't cover MCP traffic, and a server Cursor can't reach is handled by Cursor, not reported by trypatch.
- `allowedTools` isn't supported; setting it throws {@link TrypatchConfigError}.
