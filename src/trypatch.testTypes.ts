import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { trypatch } from './trypatch'
import type { TryPatchOptions } from './types'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'

/**
 * Compile-time-only checks for TryPatchOptions/@trypatch generic constraints. Nothing here runs —
 * `tsc` (via the `type-check` script) is what "tests" this file, since `src` is compiled as a
 * whole regardless of imports. Keep runtime behavior in trypatch.spec.ts.
 */

const resultSchema = z.object({
    rootCause: z.string(),
    retryable: z.boolean(),
})

const investigationProvider = {
    provider: 'openai',
    apiKey: 'test-key',
} as const

const mismatchedReturnMethod = (): { rootCause: string, retryable: string } => ({ rootCause: 'x', retryable: 'no' })

trypatch({
    aiInvestigation: { resultSchema, investigationProvider },
})(
    // @ts-expect-error - method return type must match resultSchema
    mismatchedReturnMethod,
    mockMethodDecoratorContext('run'),
)

const zodErrorSchema = z.object({
    message: z.string(),
    code: z.number(),
})

class CustomRetryableError extends Error {
    constructor (param: z.infer<typeof zodErrorSchema>) {
        super(`${param.message} (code: ${param.code})`)
        this.name = 'CustomRetryableError'
    }
}

void ({
    aiInvestigation: {
        resultSchema,
        investigationProvider,
        customErrors: [
            {
                errorConstructor: CustomRetryableError,
                description: 'Thrown when the operation can be retried',
                errorParameterSchema: zodErrorSchema,
            },
        ],
    },
} satisfies TryPatchOptions)

const jsonSchemaErrorSchema = {
    type: 'object',
    properties: {
        message: { type: 'string' },
        severity: { type: 'string' },
    },
    required: ['message', 'severity'],
    additionalProperties: false,
} as const satisfies JSONSchema

class JsonSchemaError extends Error {
    constructor (param: FromSchema<typeof jsonSchemaErrorSchema>) {
        super(`${param.message} (severity: ${param.severity})`)
        this.name = 'JsonSchemaError'
    }
}

void ({
    aiInvestigation: {
        resultSchema,
        investigationProvider,
        customErrors: [
            {
                errorConstructor: JsonSchemaError,
                description: 'Error from JSON Schema definition',
                errorParameterSchema: jsonSchemaErrorSchema,
            },
        ],
    },
} satisfies TryPatchOptions)

// `getSignal` is resolved per call from the investigation context, so it must be a factory.
void ({
    getSignal: ctx => (ctx.args[0] as { signal?: AbortSignal } | undefined)?.signal,
    customInvestigation: { investigate: () => Promise.resolve(undefined) },
} satisfies TryPatchOptions)

void ({
    // @ts-expect-error - a bare AbortSignal would exist once per decorator, not once per call
    getSignal: new AbortController().signal,
    customInvestigation: { investigate: () => Promise.resolve(undefined) },
} satisfies TryPatchOptions)

// Custom investigate handlers may ignore the options argument.
void ({
    customInvestigation: { investigate: ctx => Promise.resolve(ctx.methodName) },
} satisfies TryPatchOptions)

void ({
    customInvestigation: {
        investigate: (_ctx, { signal }) => {
            const optionalSignal: AbortSignal | undefined = signal
            return Promise.resolve(optionalSignal)
        },
    },
} satisfies TryPatchOptions)
