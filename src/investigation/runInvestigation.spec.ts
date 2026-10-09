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
import { defineTool } from '../tools'
import type { CustomErrorDefinition, InvestigationContext, TryPatchOptions } from '../types'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'
import { mockTimeoutSignal } from '../test/abort'
import { mockLanguageModel, mockOutcomeTurn, promptText } from '../test/mockLanguageModel'
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
                mockCallTiming(),
            )).rejects.toThrow(RetryableError)
        })

        it('should construct a custom error without errorParameterSchema with no parameter, whatever the model sent', async () => {
            let constructedWith: unknown[] | undefined
            class StaleCacheError extends Error {
                constructor (...args: unknown[]) {
                    super('stale cache')
                    constructedWith = args
                }
            }

            useOutcome({ type: 'error', error: 'StaleCacheError', errorSchema: { reason: 'ignored' } })

            await expect(runInvestigation(
                new Error('original'),
                {
                    aiInvestigation: {
                        investigationProvider: {
                            provider: 'openai',
                            apiKey: 'test-key',
                        },
                        customErrors: [{ errorConstructor: StaleCacheError, propagate: true }],
                    },
                },
                new Logger(),
                mockMethodDescriptor(),
                undefined,
                [],
                mockCallTiming(),
            )).rejects.toThrow(StaleCacheError)
            expect(constructedWith).toEqual([undefined])
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
            useOutcome({ type: outcomeType, reason: 'not enough information' })

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
            const options: TryPatchOptions = {
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

        it('should hand result tools the caller signal', async () => {
            const controller = new AbortController()
            let resultToolSignal: AbortSignal | undefined
            useOutcome({ type: 'resultTool', explanation: 'test explanation', toolName: 'submit', input: {} })
            const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())

            await investigateError(ctx, {
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
            }, undefined, controller.signal)

            expect(resultToolSignal?.aborted).toBe(false)
            controller.abort()
            expect(resultToolSignal?.aborted).toBe(true)
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

        it('should parse a JSON-encoded result when no resultSchema is given', async () => {
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
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
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
            useOutcome({
                type: 'resultTool',
                explanation: 'test explanation',
                toolName: 'submit_investigation',
                input: { inStock: true },
            })

            const resultTool = defineTool({
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
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), new (class Billing {})(), [], mockCallTiming())

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

            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
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
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
            useOutcome({ type: 'cannotDetermine', reason: 'logs contain no identifiable cause' })

            await expect(investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    investigationBehavior: { allowCannotDetermine: true },
                },
            })).rejects.toThrow('logs contain no identifiable cause')
        })

        it('should redact investigation prompts by default before calling the provider', async () => {
            const schema = z.object({
                inStock: z.boolean(),
            })
            const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
            const ctx = buildInvestigationContext(
                new Error(`request failed with ${secret}`),
                mockMethodDescriptor('charge'),
                undefined,
                [{ authorization: secret }],
                mockCallTiming(),
            )
            const model = useOutcome({ type: 'result', explanation: 'test explanation', result: { inStock: false } })

            await investigateError(ctx, {
                aiInvestigation: {
                    resultSchema: schema,
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                },
            })

            const userPrompt = promptText(model.doGenerateCalls[0], 'user')

            expect(userPrompt).not.toContain(secret)
            expect(userPrompt).toContain('charge')
        })

        it('should send prompts unredacted when redactConfig is false', async () => {
            const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
            const ctx = buildInvestigationContext(new Error(`request failed with ${secret}`), mockMethodDescriptor('charge'), undefined, [], mockCallTiming())
            const model = useOutcome({ type: 'result', explanation: 'test explanation', result: { inStock: false } })

            await investigateError(ctx, {
                aiInvestigation: {
                    resultSchema: z.object({ inStock: z.boolean() }),
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                    redactConfig: false,
                },
            })

            expect(promptText(model.doGenerateCalls[0], 'user')).toContain(secret)
        })
    })
})
