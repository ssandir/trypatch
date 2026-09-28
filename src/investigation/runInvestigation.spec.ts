import { z } from 'zod'
import { investigateError, runInvestigation } from './runInvestigation'
import { buildInvestigationContext } from './investigationContext'
import { TrypatchFatalError } from '../errors'
import { Logger } from '../logger'
import { Tool } from '../tools'
import type { CustomErrorDefinition, TryPatchOptions } from '../types'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'

const fetchMock = jest.fn()

beforeAll(() => {
    globalThis.fetch = fetchMock
})

afterEach(() => {
    fetchMock.mockReset()
    jest.restoreAllMocks()
})

describe('runInvestigation', () => {
    describe('runInvestigation', () => {
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
                                content: JSON.stringify({
                                    outcome: { type: 'result', result: { rootCause: 'timeout', retryable: true } },
                                }),
                            },
                        },
                    ],
                }),
            })

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
            fetchMock.mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: { message: 'provider down' } }),
            })

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

            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: { type: 'error', error: 'RetryableError', errorSchema: { reason: 'network blip' } },
                                }),
                            },
                        },
                    ],
                }),
            })

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
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: { type: 'error', error: 'RetryableError', errorSchema: { reason: 'network blip' } },
                                }),
                            },
                        },
                    ],
                }),
            })

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
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: {
                                        type: 'result',
                                        result: JSON.stringify({ rootCause: 'timeout', retryable: true }),
                                    },
                                }),
                            },
                        },
                    ],
                }),
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
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: {
                                        type: 'resultTool',
                                        toolName: 'submit_investigation',
                                        input: { rootCause: 'network', retryable: true },
                                    },
                                }),
                            },
                        },
                    ],
                }),
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
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: {
                                        type: 'error',
                                        error: 'RetryableError',
                                        errorSchema: { reason: 'network blip' },
                                    },
                                }),
                            },
                        },
                    ],
                }),
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
            fetchMock.mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    outcome: { type: 'result', result: { rootCause: 'invalid token', retryable: false } },
                                }),
                            },
                        },
                    ],
                }),
            })

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

            const fetchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
                messages: { role: string, content: string }[]
            }
            const userPrompt = fetchBody.messages.find(message => message.role === 'user')?.content ?? ''

            expect(userPrompt).not.toContain(secret)
            expect(userPrompt).toContain('charge')
        })
    })
})
