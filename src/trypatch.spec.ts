import type { JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { trypatch } from './trypatch'
import { Tool } from './tools'
import type { InvestigationContext, TryPatchOptions } from './types'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'
import { Providers } from './investigation/providers/types'

const fetchMock = jest.fn()

type InvestigationResult = {
    rootCause: string
    retryable: boolean
}

const investigationProvider = {
    provider: Providers.OPENAI,
    apiKey: 'test-key',
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
                        content: JSON.stringify({ outcome: { type: 'result', result } }),
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
            aiInvestigation: {
                resultSchema: zodSchema,
                investigationProvider,
                onInvestigationResult,
            },
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
            aiInvestigation: {
                resultSchema: jsonSchema,
                investigationProvider,
                onInvestigationResult,
            },
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
            aiInvestigation: {
                resultSchema: zodSchema,
                investigationProvider,
            },
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
            aiInvestigation: {
                resultSchema: zodSchema,
                investigationProvider,
                onInvestigationResult,
            },
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

describe('trypatch decorator dispatch', () => {
    const options = {
        customInvestigation: {
            investigate: () => Promise.resolve({}),
        },
    } satisfies TryPatchOptions

    function callDecorator (...args: unknown[]): unknown {
        return (trypatch(options) as unknown as (...callArgs: unknown[]) => unknown)(...args)
    }

    it('should wrap the method when called with the legacy (target, propertyKey, descriptor) shape', () => {
        const originalMethod = jest.fn(() => 'result')
        const descriptor: PropertyDescriptor = {
            value: originalMethod,
            enumerable: false,
            configurable: true,
            writable: true,
        }

        const result = callDecorator({}, 'run', descriptor) as PropertyDescriptor

        expect(typeof result.value).toBe('function')
        expect(result.value).not.toBe(originalMethod)
        expect(result.enumerable).toBe(false)
        expect(result.configurable).toBe(true)
    })

    it('should wrap the method when called with the stage-3 (value, context) shape', () => {
        const originalMethod = jest.fn(() => 'result')

        const result = callDecorator(originalMethod, mockMethodDecoratorContext('run'))

        expect(typeof result).toBe('function')
        expect(result).not.toBe(originalMethod)
    })

    it('should throw when the stage-3 context is not a method', () => {
        expect(() => callDecorator(jest.fn(), { kind: 'field', name: 'run' }))
            .toThrow('trypatch can only decorate methods')
    })

    it('should throw when the legacy descriptor has no function value', () => {
        expect(() => callDecorator({}, 'run', { get: () => 1, enumerable: true, configurable: true }))
            .toThrow('trypatch can only decorate methods')
    })

    it('should throw when called with neither decorator shape', () => {
        expect(() => callDecorator(class Foo {}))
            .toThrow('trypatch can only decorate methods')
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
            logging: { verbosity: 'low' },
            customInvestigation: {
                investigate,
            },
        } satisfies TryPatchOptions

        class CustomInvestigateService {
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
            aiInvestigation: {
                resultSchema,
                investigationProvider: {
                    provider: Providers.OPENAI,
                    apiKey: 'test-key',
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
            },
        } satisfies TryPatchOptions<typeof resultSchema, ServiceToolContext>

        mockOpenAiInvestigationResponse({ rootCause: 'provider root cause', retryable: false })

        class AiInvestigateService {
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
        ])
    })
})
