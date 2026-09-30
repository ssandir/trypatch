import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { investigateError, runInvestigation } from './runInvestigation'
import { buildInvestigationContext } from './investigationContext'
import {
    TrypatchCannotDetermineError,
    TrypatchFatalError,
    TrypatchNoApplicableOutcomeError,
    TrypatchUncertainResultError,
} from '../errors'
import { Logger } from '../logger'
import { Tool } from '../tools'
import type { CustomErrorDefinition, TryPatchOptions } from '../types'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'
import { mockLanguageModel, mockOutcomeTurn, promptText } from '../test/mockLanguageModel'
import { createLanguageModel } from './aiInvestigation/providers/languageModel/createLanguageModel'

jest.mock('./aiInvestigation/providers/languageModel/createLanguageModel')

function useOutcome (outcome: unknown): ReturnType<typeof mockLanguageModel> {
    const model = mockLanguageModel(mockOutcomeTurn(outcome))
    jest.mocked(createLanguageModel).mockReturnValue(model)
    return model
}

afterEach(() => {
    jest.restoreAllMocks()
})

describe('runInvestigation', () => {
    describe('runInvestigation', () => {
        const schema = z.object({
            rootCause: z.string(),
            retryable: z.boolean(),
        })

        it('should return parsed investigation results', async () => {
            useOutcome({ type: 'result', result: { rootCause: 'timeout', retryable: true } })

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
            jest.mocked(createLanguageModel).mockReturnValue(new MockLanguageModelV4({
                doGenerate: () => Promise.reject(new Error('provider down')),
            }))

            const result = await runInvestigation(
                new Error('original'),
                {
                    aiInvestigation: {
                        resultSchema: z.object({ rootCause: z.string() }),
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
            )

            expect(result).toBeUndefined()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed:', expect.any(Error))
        })

        it('should let a TrypatchFatalError propagate instead of swallowing it', async () => {
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

        it('should let a registered custom investigation error propagate instead of swallowing it', async () => {
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

        it('should swallow an unregistered error thrown from a custom investigation', async () => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }

            const result = await runInvestigation(
                new Error('original'),
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
            )

            expect(result).toBeUndefined()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed:', expect.any(Error))
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

        it('should swallow an AI investigation custom error when propagate is not set', async () => {
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

            const result = await runInvestigation(
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
            )

            expect(result).toBeUndefined()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed:', expect.any(Error))
        })
        it.each([
            ['cannotDetermine', 'allowCannotDetermine', TrypatchCannotDetermineError],
            ['uncertain', 'allowUncertainResult', TrypatchUncertainResultError],
            ['noApplicableOutcome', 'allowNoApplicableOutcome', TrypatchNoApplicableOutcomeError],
        ] as const)('should swallow a %s outcome and log it by default', async (outcomeType, allowOption, errorClass) => {
            const loggerLike = {
                log: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                debug: jest.fn(),
            }
            useOutcome({ type: outcomeType, reason: 'not enough information' })

            const result = await runInvestigation(
                new Error('original'),
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
            )

            expect(result).toBeUndefined()
            expect(loggerLike.error).toHaveBeenCalledWith('[ssandir/trypatch] Investigation failed:', expect.any(errorClass))
        })
    })

    describe('investigateError', () => {
        it('should use custom investigate override when provided', async () => {
            const options: TryPatchOptions = {
                customInvestigation: {
                    investigate: () => Promise.resolve({ rootCause: 'custom' }),
                },
            }

            const result = await investigateError(
                buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, []),
                options,
            )

            expect(result).toEqual({ rootCause: 'custom' })
        })

        it('should parse a JSON-encoded result when no resultSchema is given', async () => {
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({
                type: 'result',
                result: JSON.stringify({ rootCause: 'timeout', retryable: true }),
            })

            const result = await investigateError(ctx, {
                aiInvestigation: {
                    investigationProvider: {
                        provider: 'openai',
                        apiKey: 'test-key',
                    },
                },
            })

            expect(result).toEqual({ rootCause: 'timeout', retryable: true })
        })

        it('should invoke result tools when the provider returns a resultTool outcome', async () => {
            const schema = z.object({
                rootCause: z.string(),
                retryable: z.boolean(),
            })
            const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [])
            useOutcome({
                type: 'resultTool',
                toolName: 'submit_investigation',
                input: { rootCause: 'network', retryable: true },
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

            expect(result).toEqual({ rootCause: 'network', retryable: true })
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
                rootCause: z.string(),
                retryable: z.boolean(),
            })
            const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
            const ctx = buildInvestigationContext(
                new Error(`request failed with ${secret}`),
                mockMethodDescriptor('charge'),
                undefined,
                [{ authorization: secret }],
            )
            const model = useOutcome({ type: 'result', result: { rootCause: 'invalid token', retryable: false } })

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
