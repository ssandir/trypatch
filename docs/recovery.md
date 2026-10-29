---
title: How recovery works
---

# How recovery works

When a decorated method throws or rejects, `@trypatch` investigates the failure and returns a value in its place, or rethrows the original error when it can't produce a correct one.

{@includeCode ../examples/quick-start.ts#quick-start}

## The investigation

- trypatch passes the failure to the investigation as an {@link InvestigationContext}: the error, the method's name, arguments and source, and the call's timing.
- {@link AiInvestigationOptions | `aiInvestigation`} asks an AI provider for an outcome; [`customInvestigation`](#custom-investigation) runs your own handler instead.
- Options that could never produce an outcome throw when the decorator is applied, not on the first failure.

## Outcomes the AI can pick

Every outcome comes with an `explanation`: why the call failed and why the AI picked that outcome.

- **A value**, returned to the caller as if the method had succeeded. It's validated against {@link AiInvestigationOptions.resultSchema | `resultSchema`} first; {@link InvestigationBehavior.allowDirectResultCreation | `allowDirectResultCreation: false`} removes this outcome.
- **A result tool**, which trypatch runs and whose return value it returns. See [Tools](./tools.md).
- **A custom error** from {@link AiInvestigationOptions.customErrors | `customErrors`}, constructed with a parameter the AI supplies.
- **A fallback outcome**, when it has no correct value to offer instead of guessing one. The AI supplies a short `reason`, which becomes the error's message:
  - {@link InvestigationBehavior.allowCannotDetermine | `allowCannotDetermine`}: not enough information to work out the value → {@link TrypatchCannotDetermineError}
  - {@link InvestigationBehavior.allowUncertainResult | `allowUncertainResult`}: a candidate exists, but confidence is too low → {@link TrypatchUncertainResultError}
  - {@link InvestigationBehavior.allowNoApplicableOutcome | `allowNoApplicableOutcome`}: none of the configured outcomes fit → {@link TrypatchNoApplicableOutcomeError}

The explanation is logged at `info` level, so only with `verbosity: 'high'`, and passed to [`onAiInvestigationEnd`](./monitoring.md). Redaction placeholders in it are restored, so treat it as sensitive.

## When no value is produced

Callers get the method's original error, the same failure they'd see without trypatch. That covers fallback outcomes, custom errors without `propagate`, timeouts, provider failures and failing result tools; trypatch logs why at `error` level.

Only three errors replace the original:

- the abort reason of the signal from `getSignal` (see [Cancellation](./cancellation.md))
- {@link TrypatchFatalError}
- a `customErrors` entry with {@link CustomErrorDefinition.propagate | `propagate: true`}

## Showing the AI the method's code

{@link InvestigationBehavior.allowMethodSource | `allowMethodSource`} adds the method's code to the prompt, so the AI knows what the call was meant to return:

{@includeCode ../examples/quick-start.ts#method-source}

- It's the runtime code from `toString()`: compiled, possibly minified JavaScript of the decorated method only.
- Keep `@trypatch` directly above the method, or a wrapper from the decorators below it is sent instead.

## Custom investigation

`customInvestigation` replaces the AI with your own {@link CustomInvestigationOptions.investigate | `investigate`} handler. Its resolved value is returned in place of the error:

{@includeCode ../examples/custom-investigation.ts#custom-investigation}

- An error from its {@link CustomInvestigationOptions.customErrors | `customErrors`} reaches the caller; anything else it throws is logged, and the method rethrows its original error.
- It gets a signal that fires on `timeoutMs` or the caller's abort; an `investigate` that ignores it is abandoned.

## Return types and decorator dialects

- Decorated methods must return a `Promise` (or be `async`): the wrapper always returns one, since recovering a value is async.
- `@trypatch` works with standard (stage-3) decorators and TypeScript's legacy `experimentalDecorators` (NestJS, TypeORM, ...), with no configuration.
- With stage-3 decorators, a method that doesn't return `Promise` of the `resultSchema` type is a compile error. Legacy decorators can't see the return type, so declare it yourself.
