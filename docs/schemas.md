---
title: Schemas
---

# Schemas

`resultSchema`, tool `parameters` and `errorParameterSchema` can be Zod or JSON Schema. A schema trypatch can't use throws {@link TrypatchFatalError} when `@trypatch` is applied or the tool is defined.

## Support

- Zod schemas work with `zod` `^3.25.76` and `^4.1.8`. Import them from `zod/v4`, which is Zod 4 in both; on `zod` 3, plain `zod` is the classic Zod 3 API, which isn't supported.
- Every schema is sent to the AI as JSON Schema, so Zod types JSON Schema can't represent, like `.transform()`, aren't supported.
- JSON Schemas can be draft-07, or draft 2020-12 with `$schema` set to it.
- `format`s such as `email` are validated.
- Unknown keywords, including OpenAPI's `example` and `nullable`, are rejected.
- Tool `parameters` must describe an object, since providers require object input.

## JSON Schema types in TypeScript

Zod schemas infer types normally. JSON Schemas map to `any` rather than `FromSchema<T>`, because resolving `FromSchema` through trypatch's generic types hits TS2589 (excessively deep instantiation). Values are still validated at runtime.

Define the type yourself and annotate handlers with it:

{@includeCode ../examples/json-schema.ts#json-schema}

Use `as const satisfies JSONSchema` so `FromSchema<typeof quoteSchema>` stays precise.
