import Ajv from 'ajv'
import { z } from 'zod/v4'
import { TrypatchCannotDetermineError } from '../../errors'
import { Logger } from '../../logger'
import { mockCallTiming } from '../../test/mockCallTiming'
import { mockLanguageModel, mockOutcomeTurn, promptText } from '../../test/mockLanguageModel'
import { mockMethodDescriptor } from '../../test/mockMethodDecoratorContext'
import type { AiInvestigationOptions, CustomErrorDefinition } from '../../types'
import { buildInvestigationContext } from '../investigationContext'
import { createLanguageModel } from './providers/languageModel/createLanguageModel'
import { runAiInvestigation } from './runAiInvestigation'
import { defineTool } from './tools'

jest.mock('./providers/languageModel/createLanguageModel')

function useOutcome (outcome: unknown): ReturnType<typeof mockLanguageModel> {
    const model = mockLanguageModel(mockOutcomeTurn(outcome))
    jest.mocked(createLanguageModel).mockReturnValue(model)
    return model
}

describe('runAiInvestigation', () => {
    const investigationProvider = {
        provider: 'openai',
        apiKey: 'test-key',
    } as const

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('should parse a JSON-encoded result when no resultSchema is given', async () => {
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
        useOutcome({
            type: 'result',
            explanation: 'test explanation',
            result: JSON.stringify({ inStock: true }),
        })

        const result = await runAiInvestigation(ctx, { investigationProvider })

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

        const result = await runAiInvestigation(ctx, {
            resultSchema: schema,
            investigationProvider,
            resultTools: [resultTool],
        })

        expect(result).toEqual({ inStock: true })
    })

    it('should hand result tools the caller signal', async () => {
        const controller = new AbortController()
        let resultToolSignal: AbortSignal | undefined
        useOutcome({ type: 'resultTool', explanation: 'test explanation', toolName: 'submit', input: {} })
        const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor(), undefined, [], mockCallTiming())

        await runAiInvestigation(ctx, {
            investigationProvider,
            resultTools: [defineTool({
                name: 'submit',
                description: 'Submit the result',
                execute: (_input, _context, { signal }) => {
                    resultToolSignal = signal
                    return 'submitted'
                },
            })],
        }, undefined, controller.signal)

        expect(resultToolSignal?.aborted).toBe(false)
        controller.abort()
        expect(resultToolSignal?.aborted).toBe(true)
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
            explanation: 'test explanation',
            error: 'RetryableError',
            errorSchema: { reason: 'network blip' },
        })

        const customErrors: CustomErrorDefinition[] = [
            {
                errorConstructor: RetryableError,
                errorParameterSchema: z.object({ reason: z.string() }),
            },
        ]

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            customErrors,
        })).rejects.toThrow(RetryableError)
    })

    it('should construct a custom error without errorParameterSchema with no parameter, whatever the model sent', async () => {
        let constructedWith: unknown[] | undefined
        class StaleCacheError extends Error {
            constructor (...args: unknown[]) {
                super('stale cache')
                constructedWith = args
            }
        }

        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
        useOutcome({ type: 'error', explanation: 'test explanation', error: 'StaleCacheError', errorSchema: { reason: 'ignored' } })

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            customErrors: [{ errorConstructor: StaleCacheError }],
        })).rejects.toThrow(StaleCacheError)
        expect(constructedWith).toEqual([undefined])
    })

    it('should throw TrypatchCannotDetermineError with the AI-provided reason when allowCannotDetermine is set', async () => {
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
        useOutcome({ type: 'cannotDetermine', explanation: 'test explanation', reason: 'logs contain no identifiable cause' })

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            investigationBehavior: { allowCannotDetermine: true },
        })).rejects.toThrow('logs contain no identifiable cause')
    })

    it('should log the outcome\'s explanation and pass the result to onAiInvestigationEnd', async () => {
        const loggerLike = {
            log: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        }
        const onAiInvestigationEnd = jest.fn()
        useOutcome({ type: 'result', explanation: 'upstream renamed price', result: 'ok' })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), new (class Billing {})(), [], mockCallTiming())

        await runAiInvestigation(ctx, {
            resultSchema: z.string(),
            investigationProvider,
            onAiInvestigationEnd,
        }, new Logger({ logger: loggerLike, verbosity: 'high' }))

        expect(loggerLike.info).toHaveBeenCalledWith('[ssandir/trypatch] Investigation of Billing.run ended with outcome result', 'upstream renamed price')
        expect(onAiInvestigationEnd).toHaveBeenCalledWith(ctx, { type: 'result', result: 'ok', explanation: 'upstream renamed price' })
    })

    it('should log the explanation of an outcome that ends with an error', async () => {
        const loggerLike = {
            log: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        }
        useOutcome({ type: 'cannotDetermine', explanation: 'the logs stop before the failure', reason: 'no identifiable cause' })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), new (class Billing {})(), [], mockCallTiming())

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
        }, new Logger({ logger: loggerLike, verbosity: 'high' }))).rejects.toThrow(TrypatchCannotDetermineError)
        expect(loggerLike.info).toHaveBeenCalledWith(
            '[ssandir/trypatch] Investigation of Billing.run ended with outcome error',
            'the logs stop before the failure',
        )
    })

    it('should pass an error outcome to onAiInvestigationEnd before throwing it', async () => {
        class RetryableError extends Error {}
        const onAiInvestigationEnd = jest.fn()
        useOutcome({ type: 'error', explanation: 'upstream is rate limiting', error: 'RetryableError', errorSchema: {} })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            customErrors: [{ errorConstructor: RetryableError }],
            onAiInvestigationEnd,
        })).rejects.toThrow(RetryableError)
        expect(onAiInvestigationEnd).toHaveBeenCalledWith(ctx, {
            type: 'error',
            error: expect.any(RetryableError),
            explanation: 'upstream is rate limiting',
        })
    })

    it('should pass a failure applying the outcome to onAiInvestigationEnd as an Error', async () => {
        const onAiInvestigationEnd = jest.fn()
        useOutcome({ type: 'resultTool', explanation: 'backup has the quote', toolName: 'fetch_backup', input: {} })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            resultTools: [defineTool({
                name: 'fetch_backup',
                description: 'Fetch the quote from the backup service',
                execute: () => {
                    // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is what's under test
                    throw 'backup unavailable'
                },
            })],
            onAiInvestigationEnd,
        })).rejects.toThrow('backup unavailable')
        expect(onAiInvestigationEnd).toHaveBeenCalledWith(ctx, {
            type: 'error',
            error: expect.objectContaining({ message: 'backup unavailable', cause: 'backup unavailable' }),
            explanation: 'backup has the quote',
        })
    })

    it('should reject with the error onAiInvestigationEnd throws instead of returning the recovered value', async () => {
        const hookError = new Error('value rejected')
        useOutcome({ type: 'result', explanation: 'test explanation', result: 'ok' })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())

        await expect(runAiInvestigation(ctx, {
            resultSchema: z.string(),
            investigationProvider,
            onAiInvestigationEnd: () => Promise.reject(hookError),
        })).rejects.toBe(hookError)
    })

    it('should not call onAiInvestigationEnd once the caller aborted the investigation', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        const onAiInvestigationEnd = jest.fn()
        useOutcome({ type: 'resultTool', explanation: 'test explanation', toolName: 'submit', input: {} })
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())

        await expect(runAiInvestigation(ctx, {
            investigationProvider,
            resultTools: [defineTool({
                name: 'submit',
                description: 'Submit the result',
                execute: () => {
                    controller.abort(reason)
                    return 'submitted'
                },
            })],
            onAiInvestigationEnd,
        }, undefined, controller.signal)).rejects.toBe(reason)
        expect(onAiInvestigationEnd).not.toHaveBeenCalled()
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

        await runAiInvestigation(ctx, {
            resultSchema: schema,
            investigationProvider,
        })

        const userPrompt = promptText(model.doGenerateCalls[0], 'user')

        expect(userPrompt).not.toContain(secret)
        expect(userPrompt).toContain('charge')
    })

    it('should send prompts unredacted when redactConfig is false', async () => {
        const secret = 'sk-live-abcdefghijklmnopqrstuvwx'
        const ctx = buildInvestigationContext(new Error(`request failed with ${secret}`), mockMethodDescriptor('charge'), undefined, [], mockCallTiming())
        const model = useOutcome({ type: 'result', explanation: 'test explanation', result: { inStock: false } })

        await runAiInvestigation(ctx, {
            resultSchema: z.object({ inStock: z.boolean() }),
            investigationProvider,
            redactConfig: false,
        })

        expect(promptText(model.doGenerateCalls[0], 'user')).toContain(secret)
    })

    it('should compile the outcome schema once across investigations with the same options', async () => {
        const compile = jest.spyOn(Ajv.prototype, 'compile')
        jest.mocked(createLanguageModel).mockImplementation(() => mockLanguageModel(mockOutcomeTurn({
            type: 'result',
            explanation: 'test explanation',
            result: { inStock: true },
        })))
        const ctx = buildInvestigationContext(new Error('boom'), mockMethodDescriptor(), undefined, [], mockCallTiming())
        const options: AiInvestigationOptions = {
            resultSchema: z.object({ inStock: z.boolean() }),
            investigationProvider,
        }

        await runAiInvestigation(ctx, options)
        await runAiInvestigation(ctx, options)

        expect(new Set(compile.mock.calls.map(([schema]) => schema)).size).toBe(1)
    })
})
