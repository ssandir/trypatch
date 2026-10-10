# Security policy

## Reporting a vulnerability

Please don't open a public issue. Report it privately through [GitHub's vulnerability reporting](https://github.com/ssandir/trypatch/security/advisories/new) instead, with a description of the problem and, if you can, a minimal reproduction.

## Supported versions

Fixes are released for the latest version. Older major versions that are still maintained get fixes when the issue affects them.

## Scope

Examples of what counts as a vulnerability:

- A secret that flare-redact's detectors recognize, or that is listed in `redactConfig.terms`, reaching an investigation provider
- Arguments removed by `sanitizeArgs` reaching an investigation provider
- Tool input that bypasses a tool's `parameters` validation
- Credentials from provider or MCP server config ending up in prompts or logs

Not a vulnerability: data that no detector recognizes and that isn't listed in `redactConfig.terms` reaching the provider. Redaction only covers what it can identify, so values only your application knows are sensitive have to be listed or removed with `sanitizeArgs`.
