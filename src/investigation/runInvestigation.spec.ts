import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod/v4'
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
import { defineTool } from './aiInvestigation/tools'
import type { InvestigationContext, TrypatchOptions } from '../types'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'
import { mockTimeoutSignal } from '../test/abort'
import { mockLanguageModel, mockOutcomeTurn } from '../test/mockLanguageModel'
import { createLanguageModel } from './aiInvestigation/providers/languageModel/createLanguageModel'
import { mockCallTiming } from '../test/mockCallTiming'

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
                mockCallTiming(),
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
                mockCallTiming(),
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
            const timeout = mockTimeoutSignal()

            await expect(runInvestigation(
                originalError,
                {
                    getSignal: () => new AbortController().signal,
                    timeoutMs: 20,
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
                mockCallTiming(),
            )).rejects.toBe(originalError)
            expect(timeout).toHaveBeenCalledWith(20)
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
                mockCallTiming(),
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
                mockCallTiming(),
            )

            expect(signalFactory).toHaveBeenCalledTimes(1)
            expect(signalFactory).toHaveBeenCalledWith(expect.objectContaining({ args: [{ signal: controller.signal }] }))
            expect(investigate).toHaveBeenCalledWith(expect.anything(), { signal: expect.any(AbortSignal) })
        })

        it('should call onInvestigationStart with the investigation context before investigating', async () => {
            const calls: string[] = []
            const onInvestigationStart = jest.fn(() => {
                calls.push('start')
            })
            const investigate = jest.fn(() => {
                calls.push('investigate')
                return Promise.resolve('done')
            })

            await runInvestigation(
                originalError,
                { onInvestigationStart, customInvestigation: { investigate } },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                ['arg'],
                mockCallTiming(),
            )

            expect(onInvestigationStart).toHaveBeenCalledWith(expect.objectContaining({ error: originalError, args: ['arg'] }))
            expect(calls).toEqual(['start', 'investigate'])
        })

        it('should skip the investigation, log, and rethrow the original error when onInvestigationStart throws', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            const startError = new Error('reporter down')
            const investigate = jest.fn()

            await expect(runInvestigation(
                originalError,
                {
                    onInvestigationStart: () => Promise.reject(startError),
                    customInvestigation: { investigate },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
                mockCallTiming(),
            )).rejects.toBe(originalError)
            expect(investigate).not.toHaveBeenCalled()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', startError)
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
                mockCallTiming(),
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
                mockCallTiming(),
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
                mockCallTiming(),
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
                mockCallTiming(),
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(Error))
        })

        it('should let an AI investigation custom error propagate when propagate is true', async () => {
            class RetryableError extends Error {
                constructor (public readonly param: { reason: string }) {
                    super(param.reason)
                }
            }

            useOutcome({ type: 'error', explanation: 'test explanation', error: 'RetryableError', errorSchema: { reason: 'network blip' } })

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
                mockCallTiming(),
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
            useOutcome({ type: 'error', explanation: 'test explanation', error: 'RetryableError', errorSchema: { reason: 'network blip' } })

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
                mockCallTiming(),
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
            useOutcome({ type: outcomeType, explanation: 'test explanation', reason: 'not enough information' })

            await expect(runInvestigation(
                originalError,
                {
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        investigationBehavior: { [allowOption]: true },
                    },
                },
                new Logger({
                    logger: loggerLike,
                    verbosity: 'high',
                }),
                mockMethodDescriptor(),
                undefined,
                [],
                mockCallTiming(),
            )).rejects.toBe(originalError)
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed, rethrowing the original error', expect.any(errorClass))
        })
    })

    describe('investigateError', () => {
        it('should use custom investigate override when provided', async () => {
            const options: TrypatchOptions = {
                customInvestigation: {
                    investigate: () => Promise.resolve({ inStock: true }),
                },
            }

            const result = await investigateError(
                buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming()),
                options,
            )

            expect(result).toEqual({ inStock: true })
        })

        it('should abort the signal passed to custom investigate when the caller aborts', async () => {
            const controller = new AbortController()
            let received: AbortSignal | undefined
            const investigate = jest.fn((_ctx: unknown, { signal }: { signal?: AbortSignal }) => {
                received = signal
                return Promise.resolve('done')
            })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())

            await investigateError(ctx, { customInvestigation: { investigate } }, undefined, controller.signal)
            controller.abort()

            expect(received?.aborted).toBe(true)
        })

        it('should time out a custom investigation', async () => {
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())
            const timeout = mockTimeoutSignal()

            await expect(investigateError(ctx, {
                timeoutMs: 10,
                customInvestigation: { investigate: jest.fn() },
            })).rejects.toBeInstanceOf(TrypatchTimeoutError)
            expect(timeout).toHaveBeenCalledWith(10)
        })

        it('should not call the AI provider when the signal is already aborted', async () => {
            const model = useOutcome({ type: 'result', explanation: 'test explanation', result: 'unused' })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())

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

        it('should run result tools under the investigation timeoutMs', async () => {
            useOutcome({ type: 'resultTool', explanation: 'test explanation', toolName: 'submit', input: {} })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())
            const timeoutController = new AbortController()
            const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal)
            let resultToolSignal: AbortSignal | undefined

            await investigateError(ctx, {
                timeoutMs: 20,
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    resultTools: [defineTool({
                        name: 'submit',
                        description: 'Submit the result',
                        execute: (_input, _context, { signal }) => {
                            resultToolSignal = signal
                            return 'submitted'
                        },
                    })],
                },
            })
            timeoutController.abort()

            expect(timeout).toHaveBeenCalledWith(20)
            expect(resultToolSignal?.aborted).toBe(true)
        })
    })
})
