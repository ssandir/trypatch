import type { FromSchema, JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod/v4'
import { trypatch } from './trypatch'
import type { TrypatchOptions } from './types'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'

/**
 * Compile-time-only checks for TrypatchOptions/@trypatch generic constraints. Nothing here runs —
 * `tsc` (via the `type-check` script) is what "tests" this file, since `src` is compiled as a
 * whole regardless of imports. Keep runtime behavior in trypatch.spec.ts.
 */

const resultSchema = z.object({
    inStock: z.boolean(),
})

const investigationProvider = {
    provider: 'openai',
    apiKey: 'test-key',
} as const

const mismatchedReturnMethod = (): Promise<{ inStock: string }> => Promise.resolve({ inStock: 'no' })

trypatch({
    aiInvestigation: { resultSchema, investigationProvider },
})(
    // @ts-expect-error - method return type must match resultSchema
    mismatchedReturnMethod,
    mockMethodDecoratorContext('run'),
)

const syncMethod = (): { inStock: boolean } => ({ inStock: false })

trypatch({
    aiInvestigation: { resultSchema, investigationProvider },
})(
    // @ts-expect-error - the wrapper always returns a Promise, so the method must too
    syncMethod,
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
} satisfies TrypatchOptions)

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
} satisfies TrypatchOptions)

// `getSignal` is resolved per call from the investigation context, so it must be a factory.
void ({
    getSignal: ctx => (ctx.args[0] as { signal?: AbortSignal } | undefined)?.signal,
    customInvestigation: { investigate: () => Promise.resolve(undefined) },
} satisfies TrypatchOptions)

void ({
    // @ts-expect-error - a bare AbortSignal would exist once per decorator, not once per call
    getSignal: new AbortController().signal,
    customInvestigation: { investigate: () => Promise.resolve(undefined) },
} satisfies TrypatchOptions)

// Custom investigate handlers may ignore the options argument.
void ({
    customInvestigation: { investigate: ctx => Promise.resolve(ctx.methodName) },
} satisfies TrypatchOptions)

void ({
    customInvestigation: {
        investigate: (_ctx, { signal }) => {
            const optionalSignal: AbortSignal | undefined = signal
            return Promise.resolve(optionalSignal)
        },
    },
} satisfies TrypatchOptions)
