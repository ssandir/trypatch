import type { JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod'
import { trypatch } from './trypatch'
import { TrypatchFatalError } from './errors'
import { Tool } from './tools'
import type { InvestigationContext, TryPatchOptions } from './types'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'
import { mockLanguageModel, mockOutcomeTurn } from './test/mockLanguageModel'
import { createLanguageModel } from './investigation/aiInvestigation/providers/languageModel/createLanguageModel'

jest.mock('./investigation/aiInvestigation/providers/languageModel/createLanguageModel')

describe('trypatch', () => {
    type InvestigationResult = {
        rootCause: string
        retryable: boolean
    }

    const investigationProvider = {
        provider: 'openai',
        apiKey: 'test-key',
    } as const

    afterEach(() => {
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

    function mockInvestigationResponse (result: InvestigationResult): ReturnType<typeof mockLanguageModel> {
        const model = mockLanguageModel(mockOutcomeTurn({ type: 'result', explanation: 'test explanation', result }))
        jest.mocked(createLanguageModel).mockReturnValue(model)
        return model
    }

    describe('as a plain function', () => {
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
            mockInvestigationResponse({ rootCause: 'bad input', retryable: false })

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
            }, { explanation: 'test explanation' })
        })

        it('should return investigation results when the method throws with a JSON schema', async () => {
            const onInvestigationResult = jest.fn()
            mockInvestigationResponse({ rootCause: 'schema mismatch', retryable: true })

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
            }, { explanation: 'test explanation' })
        })

        it('should resolve sync success values through a promise', async () => {
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
            mockInvestigationResponse({ rootCause: 'async failure', retryable: true })

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
            }, { explanation: 'test explanation' })
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
                .toThrow(TrypatchFatalError)
            expect(() => callDecorator(jest.fn(), { kind: 'field', name: 'run' }))
                .toThrow('trypatch can only decorate methods')
        })

        it('should throw when the legacy descriptor has no function value', () => {
            expect(() => callDecorator({}, 'run', { get: () => 1, enumerable: true, configurable: true }))
                .toThrow(TrypatchFatalError)
            expect(() => callDecorator({}, 'run', { get: () => 1, enumerable: true, configurable: true }))
                .toThrow('trypatch can only decorate methods')
        })

        it('should throw when called with neither decorator shape', () => {
            expect(() => callDecorator(class Foo {}))
                .toThrow(TrypatchFatalError)
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
            }), {})
        })

        it('should reject with the method\'s own error when the investigation produces no value', async () => {
            const methodError = new Error('failed')

            class FailingInvestigationService {
                @trypatch({
                    customInvestigation: {
                        investigate: () => Promise.reject(new Error('investigation failed')),
                    },
                })
                run (): Promise<DecoratorResult> {
                    return Promise.reject(methodError)
                }
            }

            await expect(new FailingInvestigationService().run()).rejects.toBe(methodError)
        })

        it('should resolve className and static from the real receiver at call time', async () => {
            const investigate = jest.fn((ctx: InvestigationContext): Promise<DecoratorResult> => Promise.resolve({
                rootCause: `custom:${ctx.methodName}`,
                retryable: true,
            }))

            const customOptions = {
                customInvestigation: { investigate },
            } satisfies TryPatchOptions

            class BillingService {
                @trypatch(customOptions)
                run (_value: string): DecoratorResult {
                    throw new Error('failed')
                }

                @trypatch(customOptions)
                static runStatic (_value: string): DecoratorResult {
                    throw new Error('failed')
                }
            }

            await expect(new BillingService().run('fail')).resolves.toBeDefined()
            expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
                methodMetadata: { className: 'BillingService', static: false, private: false },
            }), {})

            investigate.mockClear()

            await expect(BillingService.runStatic('fail')).resolves.toBeDefined()
            expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
                methodMetadata: { className: 'BillingService', static: true, private: false },
            }), {})
        })

        it('should resolve the signal per call from the call arguments for instance and static methods', async () => {
            const investigate = jest.fn((_ctx: InvestigationContext, _options: { signal?: AbortSignal }) => Promise.resolve('investigated'))
            const signalOptions = {
                getSignal: (ctx: InvestigationContext) => (ctx.args[1] as { signal?: AbortSignal } | undefined)?.signal,
                customInvestigation: { investigate },
            } satisfies TryPatchOptions

            class ReportService {
                @trypatch(signalOptions)
                run (_value: string, _options?: { signal?: AbortSignal }): string {
                    throw new Error('failed')
                }

                @trypatch(signalOptions)
                static runStatic (_value: string, _options?: { signal?: AbortSignal }): string {
                    throw new Error('failed')
                }
            }

            const first = new AbortController()
            const second = new AbortController()

            await expect(new ReportService().run('fail', { signal: first.signal })).resolves.toBe('investigated')
            await expect(ReportService.runStatic('fail', { signal: second.signal })).resolves.toBe('investigated')
            await expect(new ReportService().run('fail')).resolves.toBe('investigated')

            expect(investigate.mock.calls.map(([, options]) => options)).toEqual([
                { signal: first.signal },
                { signal: second.signal },
                {},
            ])
        })

        it('should reject with the abort reason and skip the investigation when the call signal is already aborted', async () => {
            const investigate = jest.fn(() => Promise.resolve('investigated'))

            class ReportService {
                @trypatch({
                    getSignal: ctx => (ctx.args[0] as { signal: AbortSignal }).signal,
                    customInvestigation: { investigate },
                })
                run (_options: { signal: AbortSignal }): string {
                    throw new Error('failed')
                }
            }

            const reason = new Error('cancelled')

            await expect(new ReportService().run({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason)
            expect(investigate).not.toHaveBeenCalled()
        })

        it('should reject with the abort reason when the call signal fires mid-investigation', async () => {
            const controller = new AbortController()
            const reason = new Error('cancelled')

            class ReportService {
                @trypatch({
                    getSignal: ctx => (ctx.args[0] as { signal: AbortSignal }).signal,
                    customInvestigation: {
                        investigate: () => {
                            controller.abort(reason)
                            // A handler reacting to the abort with its own error must not mask the caller's reason.
                            return Promise.reject(new Error('investigation gave up'))
                        },
                    },
                })
                run (_options: { signal: AbortSignal }): string {
                    throw new Error('failed')
                }
            }

            await expect(new ReportService().run({ signal: controller.signal })).rejects.toBe(reason)
        })

        it('should apply AiInvestigationOptions via @trypatch with heterogeneous tools when the method throws', async () => {
            const onInvestigationResult = jest.fn()
            const toolContext: ServiceToolContext = { serviceName: 'billing' }

            const aiOptions = {
                logging: { verbosity: 'high' as const },
                aiInvestigation: {
                    resultSchema,
                    investigationProvider: {
                        provider: 'openai',
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

            const model = mockInvestigationResponse({ rootCause: 'provider root cause', retryable: false })

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
            }, { explanation: 'test explanation' })

            expect(model.doGenerateCalls[0]?.tools?.map(tool => tool.name)).toEqual([
                'search_logs',
                'count_retries',
            ])
        })
    })

})
