import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { investigateError, runInvestigation } from './runInvestigation'
import { buildInvestigationContext } from './investigationContext'
import {
    TrypatchCannotDetermineError,
    TrypatchFatalError,
    TrypatchNoApplicableOutcomeError,
    TrypatchTimeoutError,
    TrypatchUncertainResultError,
} from '../errors'
import { Logger } from '../logger'
import { Tool } from '../tools'
import type { CustomErrorDefinition, InvestigationContext, TryPatchOptions } from '../types'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'
import { mockLanguageModel, mockOutcomeTurn, promptText } from '../test/mockLanguageModel'
import { createLanguageModel } from './aiInvestigation/providers/languageModel/createLanguageModel'

jest.mock('./aiInvestigation/providers/languageModel/createLanguageModel')

function useOutcome (outcome: unknown): ReturnType<typeof mockLanguageModel> {
    const model = mockLanguageModel(mockOutcomeTurn(outcome))
    jest.mocked(createLanguageModel).mockReturnValue(model)
    return model
}

describe('runInvestigation', () => {
    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('runInvestigation', () => {
        const originalError = new Error('original')
        const schema = z.object({
            inStock: z.boolean(),
        })

        it('should return parsed investigation results', async () => {
            useOutcome({ type: 'result', explanation: 'test explanation', result: { inStock: true } })

            const result = await runInvestigation(
                new Error('original'),
                {
                    aiInvestigation: {
                        resultSchema: schema,
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                    },
                },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [],
            )

            expect(result).toEqual({ inStock: true })
        })

        it('should log investigation failures and rethrow the original error', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
                doGenerate: () => Promise.reject(new Error('provider down')),
            }))

            await expect(runInvestigation(
                originalError,
                {
                    aiInvestigation: {
                        resultSchema: z.object({ inStock: z.boolean() }),
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(Error))
        })

        it('should log our own investigation timeout and rethrow the original error', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
                doGenerate: () => new Promise<never>(() => undefined),
            }))

            await expect(runInvestigation(
                originalError,
                {
                    getSignal: () => new AbortController().signal,
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        investigationBehavior: { timeoutMs: 20 },
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(TrypatchTimeoutError))
        })

        it('should propagate the caller abort reason from an AI investigation instead of logging it', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            const controller = new AbortController()
            const reason = new Error('cancelled')
            jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
                doGenerate: () => {
                    controller.abort(reason)
                    return new Promise<never>(() => undefined)
                },
            }))

            await expect(runInvestigation(
                new Error('original'),
                {
                    getSignal: () => controller.signal,
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(reason)
            expect(loggerLike.error).not.toHaveBeenCalled()
        })

        it('should resolve the signal from the investigation context once and pass it to custom investigate', async () => {
            const controller = new AbortController()
            const signalFactory = jest.fn((ctx: InvestigationContext) => (ctx.args[0] as { signal: AbortSignal }).signal)
            const investigate = jest.fn(() => Promise.resolve('done'))

            await runInvestigation(
                new Error('original'),
                { getSignal: signalFactory, customInvestigation: { investigate } },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [{ signal: controller.signal }],
            )

            expect(signalFactory).toHaveBeenCalledTimes(1)
            expect(signalFactory).toHaveBeenCalledWith(expect.objectContaining({ args: [{ signal: controller.signal }] }))
            expect(investigate).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal })
        })

        it('should log an error thrown by the signal factory and rethrow the original error', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            const investigate = jest.fn(() => Promise.resolve('done'))

            await expect(runInvestigation(
                originalError,
                {
                    getSignal: () => {
                        throw new Error('no signal')
                    },
                    customInvestigation: { investigate },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(investigate).not.toHaveBeenCalled()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.objectContaining({ message: 'no signal' }))
        })

        it('should let a TrypatchFatalError propagate instead of the original error', async () => {
            await expect(runInvestigation(
                new Error('original'),
                {
                    customInvestigation: {
                        investigate: () => {
                            throw new TrypatchFatalError('misconfigured')
                        },
                    },
                },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toThrow(TrypatchFatalError)
        })

        it('should let a registered custom investigation error propagate instead of the original error', async () => {
            class RetryableError extends Error {}

            await expect(runInvestigation(
                new Error('original'),
                {
                    customInvestigation: {
                        investigate: () => {
                            throw new RetryableError('flaky')
                        },
                        customErrors: [{ errorConstructor: RetryableError }],
                    },
                },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toThrow(RetryableError)
        })

        it('should log an unregistered error thrown from a custom investigation and rethrow the original error', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }

            await expect(runInvestigation(
                originalError,
                {
                    customInvestigation: {
                        investigate: () => {
                            throw new Error('unregistered')
                        },
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(Error))
        })

        it('should let an AI investigation custom error propagate when propagate is true', async () => {
            class RetryableError extends Error {
                constructor (public readonly param: { reason: string }) {
                    super(param.reason)
                }
            }

            useOutcome({ type: 'error', error: 'RetryableError', errorSchema: { reason: 'network blip' } })

            await expect(runInvestigation(
                new Error('original'),
                {
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        customErrors: [{
                            errorConstructor: RetryableError,
                            errorParameterSchema: z.object({ reason: z.string() }),
                            propagate: true,
                        }],
                    },
                },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toThrow(RetryableError)
        })

        it('should log an AI investigation custom error and rethrow the original error when propagate is not set', async () => {
            class RetryableError extends Error {
                constructor (public readonly param: { reason: string }) {
                    super(param.reason)
                }
            }

            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            useOutcome({ type: 'error', error: 'RetryableError', errorSchema: { reason: 'network blip' } })

            await expect(runInvestigation(
                originalError,
                {
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        customErrors: [{
                            errorConstructor: RetryableError,
                            errorParameterSchema: z.object({ reason: z.string() }),
                        }],
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(Error))
        })
        it.each([
            ['cannotDetermine', 'allowCannotDetermine', TrypatchCannotDetermineError],
            ['uncertain', 'allowUncertainResult', TrypatchUncertainResultError],
            ['noApplicableOutcome', 'allowNoApplicableOutcome', TrypatchNoApplicableOutcomeError],
        ] as const)('should log a %s outcome and rethrow the original error by default', async (outcomeType, allowOption, errorClass) => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            useOutcome({ type: outcomeType, reason: 'not enough information' })

            await expect(runInvestigation(
                originalError,
                {
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        [allowOption]: true,
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(errorClass))
        })
    })

    describe('investigateError', () => {
        it('should use custom investigate override when provided', async () => {
            const options: TryPatchOptions = {
                customInvestigation: {
                    investigate: () => Promise.resolve({ inStock: true }),
                },
            }

            const result = await investigateError(
                buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, []),
                options,
            )

            expect(result).toEqual({ inStock: true })
        })

        it('should pass the given signal to custom investigate', async () => {
            const controller = new AbortController()
            const investigate = jest.fn(() => Promise.resolve('done'))
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [])

            await investigateError(ctx, { customInvestigation: { investigate } }, undefined, controller.signal)

            expect(investigate).toHaveBeenCalledWith(ctx, { signal: controller.signal })
        })

        it('should pass empty options to custom investigate when no signal is resolved', async () => {
            const investigate = jest.fn(() => Promise.resolve('done'))
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [])

            await investigateError(ctx, { customInvestigation: { investigate } }, undefined, undefined)

            expect(investigate).toHaveBeenCalledWith(ctx, {})
        })

        it('should not start a custom investigation when the signal is already aborted', async () => {
            const investigate = jest.fn(() => Promise.resolve('done'))
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [])

            await expect(investigateError(ctx, {
                customInvestigation: { investigate },
            }, undefined, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
            expect(investigate).not.toHaveBeenCalled()
        })

        it('should not call the AI provider when the signal is already aborted', async () => {
            const model = useOutcome({ type: 'result', explanation: 'test explanation', result: 'unused' })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [])

            await expect(investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                },
            }, undefined, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
            expect(model.doGenerateCalls).toHaveLength(0)
        })

        it('should hand result tools the caller signal', async () => {
            const controller = new AbortController()
            let resultToolSignal: AbortSignal | undefined
            useOutcome({ type: 'resultTool', explanation: 'test explanation', toolName: 'submit', input: {} })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [])

            await investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    resultTools: [new Tool({
                        name: 'submit',
                        description: 'Submit the result',
                        execute: (_input, _context, { signal }) => {
                            resultToolSignal = signal
                            return 'submitted'
                        },
                    })],
                },
            }, undefined, controller.signal)

            expect(resultToolSignal?.aborted).toBe(false)
            controller.abort()
            expect(resultToolSignal?.aborted).toBe(true)
        })

        it('should parse a JSON-encoded result when no resultSchema is given', async () => {
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({
                type: 'result',
                explanation: 'test explanation',
                result: JSON.stringify({ inStock: true }),
            })

            const result = await investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                },
            })

            expect(result).toEqual({ inStock: true })
        })

        it('should invoke result tools when the provider returns a resultTool outcome', async () => {
            const schema = z.object({
                inStock: z.boolean(),
            })
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({
                type: 'resultTool',
                explanation: 'test explanation',
                toolName: 'submit_investigation',
                input: { inStock: true },
            })

            const resultTool = new Tool({
                name: 'submit_investigation',
                description: 'Submit the final investigation result',
                parameters: schema,
                execute: (input: z.infer<typeof schema>): z.infer<typeof schema> => input,
            })

            const result = await investigateError(ctx, {
                aiInvestigation: {
                    resultSchema: schema,
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    resultTools: [resultTool],
                },
            })

            expect(result).toEqual({ inStock: true })
        })

        it('should log the outcome\'s explanation and pass it to onInvestigationResult', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            const onInvestigationResult = jest.fn()
            useOutcome({ type: 'result', explanation: 'upstream renamed price', result: 'ok' })
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), new (class Billing {})(), [])

            await investigateError(ctx, {
                aiInvestigation: {
                    resultSchema: z.string(),
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    onInvestigationResult,
                },
            }, new Logger({ logger: loggerLike, verbosity: 'high' }))

            expect(loggerLike.info).toHaveBeenCalledWith('[ssandir/trypatch] Investigation of Billing.run returned a result', 'upstream renamed price')
            expect(onInvestigationResult).toHaveBeenCalledWith('ok', { explanation: 'upstream renamed price' })
        })

        it('should throw the matching custom error when the provider returns an error outcome', async () => {
            class RetryableError extends Error {
                constructor (public readonly param: { reason: string }) {
                    super(param.reason)
                }
            }

            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({
                type: 'error',
                error: 'RetryableError',
                errorSchema: { reason: 'network blip' },
            })

            const customErrors: CustomErrorDefinition[] = [
                {
                    errorConstructor: RetryableError,
                    errorParameterSchema: z.object({ reason: z.string() }),
                },
            ]

            await expect(investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    customErrors,
                },
            })).rejects.toThrow(RetryableError)
        })

        it('should throw TrypatchCannotDetermineError with the AI-provided reason when allowCannotDetermine is set', async () => {
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({ type: 'cannotDetermine', reason: 'logs contain no identifiable cause' })

            await expect(investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    allowCannotDetermine: true,
                },
            })).rejects.toThrow('logs contain no identifiable cause')
        })

        it('should redact investigation prompts before calling the provider', async () => {
            const schema = z.object({
                inStock: z.boolean(),
            })
            const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
            const ctx = buildInvestigationContext(
                new Error(`request failed with ${secret}`),
                mockMethodDescriptor('charge'),
                undefined,
                [{ authorization: secret }],
            )
            const model = useOutcome({ type: 'result', explanation: 'test explanation', result: { inStock: false } })

            await investigateError(ctx, {
                aiInvestigation: {
                    resultSchema: schema,
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    redactConfig: {},
                },
            })

            const userPrompt = promptText(model.doGenerateCalls[0], 'user')

            expect(userPrompt).not.toContain(secret)
            expect(userPrompt).toContain('charge')
        })
    })
})
