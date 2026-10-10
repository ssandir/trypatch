import type { JSONSchema } from 'json-schema-to-ts'
import { z } from 'zod/v4'
import { trypatch } from './trypatch'
import { TrypatchFatalError } from './errors'
import { defineTool } from './investigation/aiInvestigation/tools'
import type { InvestigationContext, TrypatchOptions } from './types'
import { mockMethodDecoratorContext } from './test/mockMethodDecoratorContext'
import { mockLanguageModel, mockOutcomeTurn, promptText } from './test/mockLanguageModel'
import { createLanguageModel } from './investigation/aiInvestigation/providers/languageModel/createLanguageModel'

jest.mock('./investigation/aiInvestigation/providers/languageModel/createLanguageModel')

describe('trypatch', () => {
    type Product = {
        inStock: boolean
    }

    const investigationProvider = {
        provider: 'openai',
        apiKey: 'test-key',
    } as const

    afterEach(() => {
        jest.restoreAllMocks()
    })

    function trypatchMethod<This, Args extends unknown[], Return extends Promise<unknown>> (
        prototype: This,
        methodName: string,
        options: TrypatchOptions,
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

    function mockInvestigationResponse (result: Product): ReturnType<typeof mockLanguageModel> {
        const model = mockLanguageModel(mockOutcomeTurn({ type: 'result', explanation: 'test explanation', result }))
        jest.mocked(createLanguageModel).mockReturnValue(model)
        return model
    }

    describe('as a plain function', () => {
        const zodSchema = z.object({
            inStock: z.boolean(),
        })

        const jsonSchema = {
            type: 'object',
            properties: {
                inStock: { type: 'boolean' },
            },
            required: ['inStock'],
            additionalProperties: false,
        } as const satisfies JSONSchema

        it('should return investigation results when the method throws', async () => {
            const onAiInvestigationEnd = jest.fn()
            mockInvestigationResponse({ inStock: false })

            class ExampleService {
                run (): Promise<Product> {
                    throw new Error('failed')
                }
            }

            trypatchMethod(ExampleService.prototype, 'run', {
                aiInvestigation: {
                    resultSchema: zodSchema,
                    investigationProvider,
                    onAiInvestigationEnd,
                },
            })

            const service = new ExampleService()
            await expect(service.run()).resolves.toEqual({
                inStock: false,
            })
            expect(onAiInvestigationEnd).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'run' }), {
                type: 'result',
                result: { inStock: false },
                explanation: 'test explanation',
            })
        })

        it('should return investigation results when the method throws with a JSON schema', async () => {
            const onAiInvestigationEnd = jest.fn()
            mockInvestigationResponse({ inStock: true })

            class ExampleService {
                run (): Promise<Product> {
                    throw new Error('failed')
                }
            }

            trypatchMethod(ExampleService.prototype, 'run', {
                aiInvestigation: {
                    resultSchema: jsonSchema,
                    investigationProvider,
                    onAiInvestigationEnd,
                },
            })

            const service = new ExampleService()
            await expect(service.run()).resolves.toEqual({
                inStock: true,
            })
            expect(onAiInvestigationEnd).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'run' }), {
                type: 'result',
                result: { inStock: true },
                explanation: 'test explanation',
            })
        })

        it('should await investigation for async methods before returning the fallback result', async () => {
            const onAiInvestigationEnd = jest.fn()
            mockInvestigationResponse({ inStock: true })

            class ExampleService {
                async run (): Promise<Product> {
                    await Promise.resolve()
                    throw new Error('failed')
                }
            }

            trypatchMethod(ExampleService.prototype, 'run', {
                aiInvestigation: {
                    resultSchema: zodSchema,
                    investigationProvider,
                    onAiInvestigationEnd,
                },
            })

            const service = new ExampleService()
            await expect(service.run()).resolves.toEqual({
                inStock: true,
            })
            expect(onAiInvestigationEnd).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'run' }), {
                type: 'result',
                result: { inStock: true },
                explanation: 'test explanation',
            })
        })
    })

    describe('trypatch decorator dispatch', () => {
        const options = {
            customInvestigation: {
                investigate: () => Promise.resolve({}),
            },
        } satisfies TrypatchOptions

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

        it('should throw when created with AI options that would fail every investigation', () => {
            expect(() => trypatch({
                aiInvestigation: {
                    resultSchema: z.object({ count: z.string().transform(Number) }),
                    investigationProvider,
                },
            })).toThrow('resultSchema can\'t be converted to JSON Schema')
        })

        it('should throw when created with a JSON Schema that doesn\'t compile', () => {
            // A schema loaded at runtime, which the JSONSchema type can't check.
            const invalidSchema = { type: 'object', properties: { reason: { type: 'strnig' } } } as unknown as JSONSchema

            expect(() => trypatch({
                aiInvestigation: { resultSchema: invalidSchema, investigationProvider },
            })).toThrow('resultSchema is not a valid JSON Schema')
            expect(() => trypatch({
                aiInvestigation: {
                    investigationProvider,
                    customErrors: [{ errorConstructor: class RetryableError extends Error {}, errorParameterSchema: invalidSchema }],
                },
            })).toThrow('customErrors entry RetryableError errorParameterSchema is not a valid JSON Schema')
        })
    })

    describe('trypatch as decorator', () => {
        type DecoratorResult = {
            inStock: boolean
        }

        type ServiceToolContext = {
            serviceName: string
        }

        const resultSchema = z.object({
            inStock: z.boolean(),
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

        it('should apply CustomInvestigateTrypatchOptions via @trypatch when the method throws', async () => {
            const investigate = jest.fn((): Promise<DecoratorResult> => Promise.resolve({ inStock: true }))

            const customOptions = {
                logging: { verbosity: 'low' },
                customInvestigation: {
                    investigate,
                },
            } satisfies TrypatchOptions

            class CustomInvestigateService {
                @trypatch(customOptions)
                run (_value: string): Promise<DecoratorResult> {
                    throw new Error('failed')
                }
            }

            const service = new CustomInvestigateService()
            await expect(service.run('fail')).resolves.toEqual({
                inStock: true,
            })
            expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
                methodName: 'run',
                args: ['fail'],
            }), { signal: expect.any(AbortSignal) })
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

        it('should run the method body at call time, before the caller\'s next statement', async () => {
            class StatefulService {
                state = 'before'

                @trypatch({ customInvestigation: { investigate: () => Promise.resolve({ inStock: false }) } })
                run (): Promise<DecoratorResult> {
                    return Promise.resolve({ inStock: this.state === 'before' })
                }
            }

            const service = new StatefulService()
            const pending = service.run()
            service.state = 'after'

            await expect(pending).resolves.toEqual({ inStock: true })
        })

        it('should resolve className and static from the real receiver at call time', async () => {
            const investigate = jest.fn((): Promise<DecoratorResult> => Promise.resolve({ inStock: true }))

            const customOptions = {
                customInvestigation: { investigate },
            } satisfies TrypatchOptions

            class BillingService {
                @trypatch(customOptions)
                run (_value: string): Promise<DecoratorResult> {
                    throw new Error('failed')
                }

                @trypatch(customOptions)
                static runStatic (_value: string): Promise<DecoratorResult> {
                    throw new Error('failed')
                }
            }

            await expect(new BillingService().run('fail')).resolves.toBeDefined()
            expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
                methodMetadata: { className: 'BillingService', static: false, private: false },
            }), { signal: expect.any(AbortSignal) })

            investigate.mockClear()

            await expect(BillingService.runStatic('fail')).resolves.toBeDefined()
            expect(investigate).toHaveBeenCalledWith(expect.objectContaining({
                methodMetadata: { className: 'BillingService', static: true, private: false },
            }), { signal: expect.any(AbortSignal) })
        })

        it('should pass when the call started and how long it ran to the investigation', async () => {
            const investigate = jest.fn((_ctx: InvestigationContext) => Promise.resolve({ inStock: true }))
            jest.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_250)

            class TimedService {
                @trypatch({ customInvestigation: { investigate } })
                run (): Promise<DecoratorResult> {
                    return Promise.reject(new Error('failed'))
                }
            }

            const before = Date.now()
            await new TimedService().run()

            const timing = investigate.mock.calls[0]?.[0].timing
            expect(timing?.durationMs).toBe(250)
            expect(timing?.startedAt.getTime()).toBeGreaterThanOrEqual(before)
            expect(timing?.startedAt.getTime()).toBeLessThanOrEqual(Date.now())
        })

        it('should send the decorated method\'s runtime code to the provider when allowMethodSource is set', async () => {
            class InventoryService {
                @trypatch({
                    aiInvestigation: {
                        resultSchema,
                        investigationProvider,
                        investigationBehavior: { allowMethodSource: true },
                    },
                })
                checkStock (sku: string): Promise<DecoratorResult> {
                    const warehouse = 'eu-central-warehouse'
                    throw new Error(`${sku} unavailable`, { cause: warehouse })
                }
            }

            const model = mockInvestigationResponse({ inStock: false })

            await expect(new InventoryService().checkStock('sku-1')).resolves.toEqual({ inStock: false })
            expect(promptText(model.doGenerateCalls[0], 'user')).toContain('eu-central-warehouse')
        })

        it('should resolve the signal per call from the call arguments for instance and static methods', async () => {
            const investigate = jest.fn((_ctx: InvestigationContext, _options: { signal?: AbortSignal }) => Promise.resolve('investigated'))
            const signalOptions = {
                getSignal: (ctx: InvestigationContext) => (ctx.args[1] as { signal?: AbortSignal } | undefined)?.signal,
                customInvestigation: { investigate },
            } satisfies TrypatchOptions

            class ReportService {
                @trypatch(signalOptions)
                run (_value: string, _options?: { signal?: AbortSignal }): Promise<string> {
                    throw new Error('failed')
                }

                @trypatch(signalOptions)
                static runStatic (_value: string, _options?: { signal?: AbortSignal }): Promise<string> {
                    throw new Error('failed')
                }
            }

            const first = new AbortController()
            const second = new AbortController()

            await expect(new ReportService().run('fail', { signal: first.signal })).resolves.toBe('investigated')
            await expect(ReportService.runStatic('fail', { signal: second.signal })).resolves.toBe('investigated')
            await expect(new ReportService().run('fail')).resolves.toBe('investigated')

            const signals = investigate.mock.calls.map(([, options]) => (options as { signal: AbortSignal }).signal)
            first.abort()

            expect(signals.map(signal => signal.aborted)).toEqual([true, false, false])
        })

        it('should reject with the abort reason and skip the investigation when the call signal is already aborted', async () => {
            const investigate = jest.fn(() => Promise.resolve('investigated'))

            class ReportService {
                @trypatch({
                    getSignal: ctx => (ctx.args[0] as { signal: AbortSignal }).signal,
                    customInvestigation: { investigate },
                })
                run (_options: { signal: AbortSignal }): Promise<string> {
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
                run (_options: { signal: AbortSignal }): Promise<string> {
                    throw new Error('failed')
                }
            }

            await expect(new ReportService().run({ signal: controller.signal })).rejects.toBe(reason)
        })

        it('should apply AiInvestigationOptions via @trypatch with heterogeneous tools when the method throws', async () => {
            const onAiInvestigationEnd = jest.fn()
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
                        maxTokens: 512,
                    },
                    investigationBehavior: {
                        systemPrompt: 'Investigate production errors.',
                        prompt: (ctx: InvestigationContext) => `Method ${ctx.methodName} failed with ${String(ctx.error)}`,
                        sanitizeArgs: (args: unknown[]) => args.map(String),
                    },
                    toolContext,
                    investigationTools: [
                        defineTool({
                            name: 'search_logs',
                            description: 'Search logs by query string',
                            parameters: investigationQuerySchema,
                            execute: (input, ctx?: ServiceToolContext) => `logs:${input.query}:${ctx?.serviceName ?? ''}`,
                        }),
                        defineTool({
                            name: 'count_retries',
                            description: 'Return retry limit from input',
                            parameters: investigationLimitSchema,
                            execute: (input: { limit: number }) => input.limit,
                        }),
                    ],
                    resultTools: [
                        defineTool({
                            name: 'submit_summary',
                            description: 'Submit investigation summary as the result',
                            parameters: resultSummarySchema,
                            execute: () => ({ inStock: true }),
                        }),
                        defineTool({
                            name: 'submit_note',
                            description: 'Submit investigation note as the result',
                            parameters: resultNoteSchema,
                            execute: () => ({ inStock: false }),
                        }),
                    ],
                    onAiInvestigationEnd,
                },
            } satisfies TrypatchOptions<typeof resultSchema, ServiceToolContext>

            const model = mockInvestigationResponse({ inStock: false })

            class AiInvestigateService {
                @trypatch(aiOptions)
                run (_value: string): Promise<DecoratorResult> {
                    throw new Error('failed')
                }
            }

            const service = new AiInvestigateService()
            await expect(service.run('fail')).resolves.toEqual({
                inStock: false,
            })
            expect(onAiInvestigationEnd).toHaveBeenCalledWith(expect.objectContaining({ methodName: 'run' }), {
                type: 'result',
                result: { inStock: false },
                explanation: 'test explanation',
            })

            expect(model.doGenerateCalls[0]?.tools?.map(tool => tool.name)).toEqual([
                'trypatch_builtin_wait',
                'trypatch_builtin_read_call_context',
                'trypatch_builtin_decode',
                'trypatch_builtin_encode',
                'search_logs',
                'count_retries',
            ])
        })
    })

})
