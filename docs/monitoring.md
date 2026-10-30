---
title: Monitoring
---

# Monitoring

When trypatch recovers a call, the caller sees a success, so the failure behind it never reaches your usual error handling. Callbacks and logging let you report it yourself: to an error tracker (Sentry, Datadog, Bugsnag, ...), a metric, or your own logs.

## `onInvestigationStart`

{@linkcode TrypatchAiOptions.onInvestigationStart | onInvestigationStart} runs when the method fails, before the investigation. It gets the {@link InvestigationContext}, with the original error as `ctx.error`.

{@includeCode ../examples/monitoring.ts#investigation-start}

## `onAiInvestigationEnd`

{@linkcode AiInvestigationOptions.onAiInvestigationEnd | onAiInvestigationEnd} runs once the AI's outcome has been applied, before the method returns or rejects. It gets the same context and a {@link ResolvedOutcome}: the value the method returns, or the error the outcome ended with (a custom or fallback error, or whatever failed while applying it, such as a result tool throwing), each with the AI's `explanation`.

{@includeCode ../examples/monitoring.ts#investigation-end}

## Callback behavior

- **Awaited.** Callbacks can be async, and the method's result waits for them. `onAiInvestigationEnd` counts towards `timeoutMs`.
- **A throw breaks the flow.** It's handled like a failed investigation: logged, and the method rethrows its original error. For `onInvestigationStart` that skips the investigation; for `onAiInvestigationEnd` it discards a recovered value. Catch errors inside the callback if reporting must never affect the call.
- **Not redacted.** See [Redaction](./redaction.md).

## Logging

trypatch logs through {@linkcode TrypatchAiOptions.logging | logging.logger} and logs nothing without one.

- Investigations that end without a value are logged at `error` level, including those that fail before the AI picks an outcome (provider error, timeout, invalid response), when `onAiInvestigationEnd` isn't called. Forward `error` to your monitoring to catch them.
- Unavailable MCP servers and failed Cursor cancellations are logged at `warn` level.
- Each outcome and its explanation are logged at `info` level.
- {@linkcode TrypatchAiOptions.logging | verbosity: 'low'} logs each message only, without error objects or the explanation.
