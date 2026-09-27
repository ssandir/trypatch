import { z } from 'zod'
import { handleError } from './handleError'
import { Logger } from './logger'
import { mockMethodDescriptor } from './test/mockMethodDecoratorContext'
import { Providers } from './investigation/providers/types'

const fetchMock = jest.fn()

beforeAll(() => {
    globalThis.fetch = fetchMock
})

afterEach(() => {
    fetchMock.mockReset()
    jest.restoreAllMocks()
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
                            content: JSON.stringify({
                                outcome: { type: 'result', result: { rootCause: 'timeout', retryable: true } },
                            }),
                        },
                    },
                ],
            }),
        })

        const result = await handleError(
            new Error('original'),
            {
                aiInvestigation: {
                    resultSchema: schema,
                    investigationProvider: {
                        provider: Providers.OPENAI,
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

        const result = await handleError(
            new Error('original'),
            {
                aiInvestigation: {
                    resultSchema: z.object({ rootCause: z.string() }),
                    investigationProvider: {
                        provider: Providers.OPENAI,
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
})
