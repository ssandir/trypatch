# trypatch e2e (vibecoded)

**This folder is vibecoded.** It was generated with an AI assistant to check that `@ssandir/trypatch` works against real providers and to show what an investigation actually receives. It has not been reviewed to the library's standards and is not a reference for how library code should look.

## Rules that differ from the root

- The root `AGENTS.md` conventions (comment policy, types in `types.ts`, logging format, test layout) **do not apply here**. Don't copy patterns from this folder into `src/`, and don't "fix" this folder to match `src/` unless asked.
- Root `npm run lint` **does** cover this folder (type-aware, using `e2e/tsconfig.json`), so code here must pass it. That needs `e2e/node_modules` installed: run `npm --prefix e2e run setup` after building the root.
- Import the library only as `@ssandir/trypatch`, never from `../src`. The point is to exercise the packed tarball a consumer installs: `scripts/setup.mjs` runs `npm pack` on the root and installs the result from `.pack/trypatch.tgz`. There's no lockfile here (`package-lock=false`), since the tarball's contents change on every build and a lockfile would pin its integrity hash; this also means the library's dependencies resolve fresh, like for a consumer installing today.
- Each run makes real, paid API calls. Don't run it in loops, and don't add it to the root `npm test`.
- A missing `ANTHROPIC_API_KEY` must fail the run, not skip it: a skipped e2e reads as a pass.
- CI runs this only when the repository owner comments `[e2e]` on a PR (`.github/workflows/e2e.yml`); never make it run automatically on push or PR events.

## Running

```bash
cd e2e
npm test
```

`pretest` builds the root, repacks and reinstalls the tarball, and type-checks this folder. The key comes from the environment or `e2e/.env` (gitignored).

## Layout

- `claude.e2e.ts`: the test. The "application code" (a shipping-quote client decorated with `@trypatch`) lives at the top of the file on purpose, so the scenario reads like a real consumer.
- `support/carrierStub.ts`: local fake carrier API plus an APM-style request log the investigation tool reads.
- `support/recorder.ts`: captures provider HTTP traffic through the public `fetch` option, trypatch's log calls, and writes the report.
- `output/` (gitignored): one JSON report per run, written even when the test fails.

## Assertions

Hard assertions cover things the scenario makes unambiguous (schema validity, fields copied from the served response, `etaDays` inside the served `eta_range`, tool use, no secret in any provider request, no error logs). Judgment calls the model may reasonably make differently (e.g. picking the range's max) go under `soft` in the report instead of failing the test.
