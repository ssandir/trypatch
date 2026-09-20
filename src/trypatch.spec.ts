import type { JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { trypatch } from './trypatch'
import { handleError } from './handleError'
import { Logger } from './logger'
import { Tool } from './tools'
import type { InvestigationContext, TryPatchOptions } from './trypatchOptions'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'
import { Providers } from './investigation/providers/types'

const fetchMock = jest.fn()

type InvestigationResult = {
    rootCause: string
    retryable: boolean
}

const investigationProvider = {
    provider: Providers.OPENAI,
    auth: { kind: 'inline', apiKey: 'test-key' },
} as const

beforeAll(() => {
    globalThis.fetch = fetchMock
})

afterEach(() => {
    fetchMock.mockReset()
    jest.restoreAllMocks()
})

function trypatchMethod<This, Args extends unknown[], Return> (
    prototype: This,
    methodName: string,
    options: TryPatchOptions,
): void {
    const originalMethod = (prototype as Record<string, (...args: Args) => Return>)[methodName]!
    const trypatchedMethod = trypatch(options)(
        originalMethod,
        mockMethodDecoratorContext(methodName) as ClassMethodDecoratorContext<This, (...args: Args) => Return>,
    )
    Object.defineProperty(prototype, methodName, {
        value: trypatchedMethod,
        writable: true,
        configurable: true,
    })
}

function mockOpenAiInvestigationResponse (result: InvestigationResult): void {
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
            choices: [
                {
                    message: {
                        content: JSON.stringify(result),
                    },
                },
            ],
        }),
    })
}

describe('trypatch', () => {
    const zodSchema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    const jsonSchema = {
        type: 'object',
        properties: {
            rootCause: { type: 'string' },
            retryable: { type: 'boolean' },
        },
        required: ['rootCause', 'retryable'],
        additionalProperties: false,
    } as const satisfies JSONSchema

    it('should return investigation results when the method throws', async () => {
        const onInvestigationResult = jest.fn()
        mockOpenAiInvestigationResponse({ rootCause: 'bad input', retryable: false })

        class ExampleService {
            run (value: string): InvestigationResult {
                if (value === 'fail') {
                    throw new Error('failed')
                }
                return { rootCause: value, retryable: false }
            }
        }

        trypatchMethod(ExampleService.prototype, 'run', {
            resultSchema: zodSchema,
            investigationProvider,
            onInvestigationResult,
        })

        const service = new ExampleService()
        await expect(service.run('fail')).resolves.toEqual({
            rootCause: 'bad input',
            retryable: false,
        })
        expect(onInvestigationResult).toHaveBeenCalledWith({
            rootCause: 'bad input',
            retryable: false,
        })
    })

    it('should return investigation results when the method throws with a JSON schema', async () => {
        const onInvestigationResult = jest.fn()
        mockOpenAiInvestigationResponse({ rootCause: 'schema mismatch', retryable: true })

        class ExampleService {
            run (value: string): InvestigationResult {
                if (value === 'fail') {
                    throw new Error('failed')
                }
                return { rootCause: value, retryable: false }
            }
        }

        trypatchMethod(ExampleService.prototype, 'run', {
            resultSchema: jsonSchema,
            investigationProvider,
            onInvestigationResult,
        })

        const service = new ExampleService()
        await expect(service.run('fail')).resolves.toEqual({
            rootCause: 'schema mismatch',
            retryable: true,
        })
        expect(onInvestigationResult).toHaveBeenCalledWith({
            rootCause: 'schema mismatch',
            retryable: true,
        })
    })

    it('should resolve sync success values through a promise', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ choices: [] }),
        })

        class ExampleService {
            run (value: string): InvestigationResult {
                return { rootCause: value, retryable: false }
            }
        }

        trypatchMethod(ExampleService.prototype, 'run', {
            resultSchema: zodSchema,
            investigationProvider,
        })

        const service = new ExampleService()
        await expect(service.run('ok')).resolves.toEqual({ rootCause: 'ok', retryable: false })
    })

    it('should await investigation for async methods before returning the fallback result', async () => {
        const onInvestigationResult = jest.fn()
        mockOpenAiInvestigationResponse({ rootCause: 'async failure', retryable: true })

        class ExampleService {
            async run (value: string): Promise<InvestigationResult> {
                await Promise.resolve()
                if (value === 'fail') {
                    throw new Error('failed')
                }
                return { rootCause: value, retryable: false }
            }
        }

        trypatchMethod(ExampleService.prototype, 'run', {
            resultSchema: zodSchema,
            investigationProvider,
            onInvestigationResult,
        })

        const service = new ExampleService()
        await expect(service.run('fail')).resolves.toEqual({
            rootCause: 'async failure',
            retryable: true,
        })
        expect(onInvestigationResult).toHaveBeenCalledWith({
            rootCause: 'async failure',
            retryable: true,
        })
    })
})

describe('trypatch types', () => {
    const zodSchema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    it('should reject zod schema mismatches against method return type', () => {
        expect.assertions(0)

        class ExampleService {
            run (): { rootCause: string, retryable: string } {
                return { rootCause: 'x', retryable: 'no' }
            }
        }

        trypatch({ resultSchema: zodSchema, investigationProvider })(
            // @ts-expect-error - method return type must match resultSchema
            ExampleService.prototype.run,
            mockMethodDecoratorContext('run'),
        )
    })
})

describe('handleError', () => {
    const schema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    it('should return parsed investigation results', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ rootCause: 'timeout', retryable: true }),
                        },
                    },
                ],
            }),
        })

        const result = await handleError(
            new Error('original'),
            {
                resultSchema: schema,
                investigationProvider: {
                    provider: Providers.OPENAI,
                    auth: { kind: 'inline', apiKey: 'test-key' },
                },
            },
            new Logger(),
            mockMethodDecoratorContext(),
            () => ({ rootCause: 'ok', retryable: false }),
            [],
        )

        expect(result).toEqual({ rootCause: 'timeout', retryable: true })
    })

    it('should swallow investigation failures and log them', async () => {
        const loggerLike = {
            log: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        }
        fetchMock.mockResolvedValue({
            ok: false,
            status: 500,
            json: () => Promise.resolve({ error: { message: 'provider down' } }),
        })

        const result = await handleError(
            new Error('original'),
            {
                resultSchema: z.object({ rootCause: z.string() }),
                investigationProvider: {
                    provider: Providers.OPENAI,
                    auth: { kind: 'inline', apiKey: 'test-key' },
                },
            },
            new Logger({
                logger: loggerLike,
                verbosity: 'high',
            }),
            mockMethodDecoratorContext(),
            () => ({ rootCause: 'ok' }),
            [],
        )

        expect(result).toBeUndefined()
        expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed:', expect.any(Error))
    })
})

describe('trypatch as decorator', () => {
    type DecoratorResult = {
        rootCause: string
        retryable: boolean
    }

    type ServiceToolContext = {
        serviceName: string
    }

    const resultSchema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    const investigationQuerySchema = z.object({
        query: z.string(),
    })

    const investigationLimitSchema = {
        type: 'object',
        properties: {
            limit: { type: 'number' },
        },
        required: ['limit'],
        additionalProperties: false,
    } as const satisfies JSONSchema

    const resultSummarySchema = z.object({
        summary: z.string(),
    })

    const resultNoteSchema = {
        type: 'object',
        properties: {
            note: { type: 'string' },
        },
        required: ['note'],
        additionalProperties: false,
    } as const satisfies JSONSchema

    it('should apply CustomInvestigateTryPatchOptions via @trypatch when the method throws', async () => {
        const investigate = jest.fn((ctx: InvestigationContext): Promise<DecoratorResult> => Promise.resolve({
            rootCause: `custom:${ctx.methodName}`,
            retryable: true,
        }))

        const customOptions = {
            logging: { verbosity: 'low' as const },
            investigate,
        } satisfies TryPatchOptions

        class CustomInvestigateService {
            // @ts-expect-error - decorator type inference issue
            @trypatch(customOptions)
            run (_value: string): DecoratorResult {
                throw new Error('failed')
            }
        }

        const service = new CustomInvestigateService()
        await expect(service.run('fail')).resolves.toEqual({
            rootCause: 'custom:run',
            retryable: true,
        })
        expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
            methodName: 'run',
            args: ['fail'],
        }))
    })

    it('should apply AiInvestigationOptions via @trypatch with heterogeneous tools when the method throws', async () => {
        const onInvestigationResult = jest.fn()
        const toolContext: ServiceToolContext = { serviceName: 'billing' }

        const aiOptions = {
            logging: { verbosity: 'high' as const },
            resultSchema,
            investigationProvider: {
                provider: Providers.OPENAI,
                auth: { kind: 'inline' as const, apiKey: 'test-key' },
                model: 'gpt-5.5',
                baseURL: 'https://api.openai.com/v1',
                organization: 'org-test',
                project: 'proj-test',
            },
            investigationBehavior: {
                systemPrompt: 'Investigate production errors.',
                prompt: (ctx: InvestigationContext) => `Method ${ctx.methodName} failed with ${ctx.error}`,
                timeoutMs: 30_000,
                maxTokens: 512,
                sanitizeArgs: (args: unknown[]) => args.map(String),
            },
            toolContext,
            investigationTools: [
                new Tool({
                    name: 'search_logs',
                    description: 'Search logs by query string',
                    parameters: investigationQuerySchema,
                    execute: (input, ctx?: ServiceToolContext) => `logs:${input.query}:${ctx?.serviceName ?? ''}`,
                }),
                new Tool({
                    name: 'count_retries',
                    description: 'Return retry limit from input',
                    parameters: investigationLimitSchema,
                    execute: (input: unknown) => (input as { limit: number }).limit,
                }),
            ],
            resultTools: [
                new Tool({
                    name: 'submit_summary',
                    description: 'Submit investigation summary as the result',
                    parameters: resultSummarySchema,
                    execute: (input) => ({
                        rootCause: input.summary,
                        retryable: true,
                    }),
                }),
                new Tool({
                    name: 'submit_note',
                    description: 'Submit investigation note as the result',
                    parameters: resultNoteSchema,
                    execute: (input: unknown) => ({
                        rootCause: (input as { note: string }).note,
                        retryable: false,
                    }),
                }),
            ],
            onInvestigationResult,
        } satisfies TryPatchOptions<typeof resultSchema, ServiceToolContext>

        mockOpenAiInvestigationResponse({ rootCause: 'provider root cause', retryable: false })

        class AiInvestigateService {
            // @ts-expect-error - decorator type inference issue
            @trypatch(aiOptions)
            run (_value: string): DecoratorResult {
                throw new Error('failed')
            }
        }

        const service = new AiInvestigateService()
        await expect(service.run('fail')).resolves.toEqual({
            rootCause: 'provider root cause',
            retryable: false,
        })
        expect(onInvestigationResult).toHaveBeenCalledWith({
            rootCause: 'provider root cause',
            retryable: false,
        })

        const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
            tools?: { function: { name: string } }[]
        }
        expect(fetchBody.tools?.map(tool => tool.function.name)).toEqual([
            'search_logs',
            'count_retries',
            'submit_summary',
            'submit_note',
        ])
    })
})
