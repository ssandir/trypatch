# Contributing to trypatch

Bug reports, fixes and improvements are welcome. For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Setup

Requires Node 22.12+.

```bash
npm install
npm run e2e:setup
```

`npm install` also installs a pre-commit hook that lints the staged files and type-checks the project. `npm run e2e:setup` builds the library and installs it into `e2e/`, which root `npm run lint` needs. It makes no provider calls.

## Checks

Run these before opening a pull request; CI runs the same ones:

```bash
npm run build
npm run type-check
npm run lint
npm test
```

`npm run lint` is part of type safety here, not just style: type-aware ESLint rules catch mistakes `tsc` lets through.

[AGENTS.md](AGENTS.md) describes how the library is put together and the conventions the code follows.

## End-to-end tests

`e2e/` runs real investigations against Claude, so it costs money and isn't part of `npm test`. Maintainers run it on pull requests when a change needs it. If you have your own Anthropic API key, [e2e/README.md](e2e/README.md) explains how to run it locally.

## Pull requests

- CI runs on pull requests once they're out of draft.
- Pull requests are squash-merged, so don't worry about tidying up commit history. There is no commit message convention.
- Releases are cut by maintainers; don't bump the version in your pull request.

## Sign your commits (DCO)

Every commit must be signed off to certify the [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the change, or otherwise have the right to submit it under this project's license. Add the sign-off with `-s`:

```bash
git commit -s -m "Fix the thing"
```

This appends a `Signed-off-by: Your Name <you@example.com>` line matching your git identity. To sign off commits you've already made on your branch:

```bash
git rebase --signoff main
```

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same license as the project.
