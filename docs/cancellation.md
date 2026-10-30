---
title: Cancellation
---

# Cancellation

A signal can abort an investigation, e.g. when the calling request is cancelled. Decorator options are evaluated once, but a caller's signal exists per call, so {@linkcode TrypatchAiOptions.getSignal | getSignal} gets the investigation context, including the call's arguments, and returns that call's signal.

{@includeCode ../examples/cancellation.ts#cancellation}

For a signal not tied to a call, such as app shutdown:

{@includeCode ../examples/cancellation.ts#shutdown}

## Behavior

- **Your abort, your error.** The method rejects with the signal's `reason`, like `fetch` does. An already-aborted signal skips the investigation.
- **Our timeout, our error.** {@linkcode TrypatchAiOptions.timeoutMs | timeoutMs} and your signal are combined. If the timeout fires first, it's logged and the method rethrows its original error, like any investigation failure.
- **Tools** get `{ signal }` as `execute`'s third argument; it also fires on the tool's own `timeoutMs`. Result tools get the same combined signal.
- **MCP** connections and tool calls are cancelled too.
- **Custom investigations** get it as `investigate(ctx, { signal })`.
- **Cursor** stops polling and asks Cursor to cancel the remote run. That request is best effort: if it fails, trypatch logs a warning and the run may keep going.
- Work that ignores the signal is abandoned, not stopped.
