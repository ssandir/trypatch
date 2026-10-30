---
title: Tools
---

# Tools

Tools are created with {@link defineTool} and come in two kinds:

- **Investigation tools** ({@linkcode AiInvestigationOptions.investigationTools | investigationTools}): the AI calls them while investigating and reads their output, which never reaches your caller. Keep them read-only.
- **Result tools** ({@linkcode AiInvestigationOptions.resultTools | resultTools}): the AI picks one as its outcome, with its input, and trypatch calls it once the investigation is done. **Its return value is what the decorated method returns**, so this is where recovery actions belong: retries, fallbacks, cache reads.

{@includeCode ../examples/tools.ts#tools}

## The tool loop

- The AI can call investigation tools over several turns before it picks an outcome. {@linkcode ClaudeInvestigationConfig.maxToolIterations | maxToolIterations} on the provider config caps the turns, and `timeoutMs` bounds the whole loop.
- If an investigation tool throws, the error goes back to the AI so it can try something else; the investigation doesn't fail.
- With redaction on, a tool's input has placeholders restored before it runs, and its output is redacted before the AI sees it. See [Redaction](./redaction.md).
- `cursor` doesn't run investigation tools, since its cloud agent runs its own; give it tools through [MCP servers](./mcp-servers.md).

## Calling `execute`

- Its input is validated against `parameters` first. A tool without `parameters` takes no input, and `execute` receives `undefined`.
- Its second argument is {@linkcode AiInvestigationOptions.toolContext | toolContext}, and its third is `{ signal }`. See [Cancellation](./cancellation.md).
- A tool still running at a deadline is abandoned; listen to `signal` to actually stop it.

## Result tools

- A result tool runs inside the investigation's `timeoutMs`, and its own `timeoutMs` still applies.
- If it throws, the investigation fails, and the method rethrows its original error.
- Its return type is checked against `resultSchema` at compile time. Its value isn't validated at runtime, since it's your code.

## Built-in safe toolbox

Unless {@linkcode InvestigationBehavior.allowSafeToolbox | allowSafeToolbox} is `false`, the AI also gets tools named `trypatch_builtin_*` to:

- `wait`, e.g. for a rate limit to reset
- `read_call_context`: read parts of the error or arguments the prompt cut short, after `sanitizeArgs`
- `decode` and `encode` base64, hex and JWTs (JWTs are decoded only, never verified)

They're never result tools.
