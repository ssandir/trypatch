import { z } from 'zod/v4'
import { buildOutcomeEnvelopeSchema, buildOutcomeSchema, parseProviderOutcome } from './outcomeSchema'
import { TrypatchConfigError } from '../../../errors'
import { defineTool } from '../tools'
import type { CustomErrorDefinition } from '../../../types'

function outcomeVariants (outcomeSchema: ReturnType<typeof buildOutcomeSchema>) {
    const outcome = outcomeSchema.properties.outcome as { anyOf?: unknown[], properties?: { type: { enum: string[] } } }
    return outcome.anyOf ?? [outcome]
}

function variantTypes (outcomeSchema: ReturnType<typeof buildOutcomeSchema>): string[] {
    return outcomeVariants(outcomeSchema).map(variant => (variant as { properties: { type: { enum: string[] } } }).properties.type.enum[0]!)
}

const disableFallbackOutcomes = {
    allowCannotDetermine: false,
    allowUncertainResult: false,
    allowNoApplicableOutcome: false,
} as const

describe('buildOutcomeSchema', () => {
    const resultTool = defineTool({
        name: 'submit_investigation',
        description: 'Submit the final investigation result',
        parameters: z.object({ note: z.string() }),
        execute: (input: { note: string }) => input,
    })

    const customErrors: CustomErrorDefinition[] = [
        {
            errorConstructor: class RetryableError extends Error {},
            errorParameterSchema: z.object({ reason: z.string() }),
        },
    ]

    it('should include the result, cannotDetermine, uncertain, and noApplicableOutcome variants by default', () => {
        const schema = buildOutcomeSchema({})
        expect(variantTypes(schema)).toEqual(['result', 'cannotDetermine', 'uncertain', 'noApplicableOutcome'])
    })

    it('should require an explanation on every variant', () => {
        const schema = buildOutcomeSchema({ resultTools: [resultTool], customErrors })
        const variants = outcomeVariants(schema) as { required: string[] }[]
        expect(variants).toHaveLength(6)
        expect(variants.every(variant => variant.required.includes('explanation'))).toBe(true)
    })

    it('should describe the result as a JSON-encoded string when no resultSchema is given', () => {
        const schema = buildOutcomeSchema({})
        const [variant] = outcomeVariants(schema) as { properties: { result: unknown } }[]
        expect(variant!.properties.result).toMatchObject({ type: 'string' })
    })

    it('should describe the result and result tool variants as the method\'s return value', () => {
        const schema = buildOutcomeSchema({ resultTools: [resultTool], ...disableFallbackOutcomes })
        const variants = outcomeVariants(schema) as { description: string }[]
        expect(variants.map(variant => variant.description)).toEqual([
            expect.stringContaining('returned from the method in place of the error'),
            expect.stringContaining('from the method in place of the error'),
        ])
        expect(variants[0]!.description).toContain('Submit the final investigation result')
    })

    it('should exclude the result variant when allowDirectResultCreation is false and a result tool is provided', () => {
        const schema = buildOutcomeSchema({ allowDirectResultCreation: false, resultTools: [resultTool], ...disableFallbackOutcomes })
        expect(variantTypes(schema)).toEqual(['resultTool'])
    })

    it('should exclude the result variant when allowDirectResultCreation is false and a custom error is provided', () => {
        const schema = buildOutcomeSchema({ allowDirectResultCreation: false, customErrors, ...disableFallbackOutcomes })
        expect(variantTypes(schema)).toEqual(['error'])
    })

    it('should describe a custom error without errorParameterSchema with an empty object errorSchema', () => {
        const schema = buildOutcomeSchema({
            allowDirectResultCreation: false,
            customErrors: [{ errorConstructor: class StaleCacheError extends Error {} }],
            ...disableFallbackOutcomes,
        })
        const [variant] = outcomeVariants(schema) as { properties: { errorSchema: unknown } }[]
        expect(variant!.properties.errorSchema).toEqual({ type: 'object', properties: {} })
    })

    it('should throw when allowDirectResultCreation is false with no result tools, custom errors, or fallback outcomes', () => {
        const options = { allowDirectResultCreation: false, ...disableFallbackOutcomes }
        expect(() => buildOutcomeSchema(options))
            .toThrow(TrypatchConfigError)
        expect(() => buildOutcomeSchema(options))
            .toThrow('AI investigation has no possible outcome')
    })

    it('should exclude the cannotDetermine variant when allowCannotDetermine is explicitly false', () => {
        const schema = buildOutcomeSchema({ allowCannotDetermine: false })
        expect(variantTypes(schema)).toEqual(['result', 'uncertain', 'noApplicableOutcome'])
    })

    it('should exclude the uncertain variant when allowUncertainResult is explicitly false', () => {
        const schema = buildOutcomeSchema({ allowUncertainResult: false })
        expect(variantTypes(schema)).toEqual(['result', 'cannotDetermine', 'noApplicableOutcome'])
    })

    it('should exclude the noApplicableOutcome variant when allowNoApplicableOutcome is explicitly false', () => {
        const schema = buildOutcomeSchema({ allowNoApplicableOutcome: false })
        expect(variantTypes(schema)).toEqual(['result', 'cannotDetermine', 'uncertain'])
    })

    it('should allow cannotDetermine as the only outcome when everything else is disabled', () => {
        const schema = buildOutcomeSchema({
            allowDirectResultCreation: false,
            allowCannotDetermine: true,
            allowUncertainResult: false,
            allowNoApplicableOutcome: false,
        })
        expect(variantTypes(schema)).toEqual(['cannotDetermine'])
    })

    it('should accept any payload in the envelope schema, but still check the outcome around it', () => {
        const envelope = buildOutcomeEnvelopeSchema({
            resultSchema: z.object({ email: z.email() }),
            resultTools: [resultTool],
            customErrors,
        })
        const anything = { not: ['what', 'the', 'schemas', 'describe'] }

        expect(parseProviderOutcome({ outcome: { type: 'result', explanation: 'x', result: anything } }, envelope))
            .toEqual({ type: 'result', explanation: 'x', result: anything })
        expect(parseProviderOutcome({ outcome: { type: 'resultTool', explanation: 'x', toolName: 'submit_investigation', input: anything } }, envelope))
            .toMatchObject({ input: anything })
        expect(parseProviderOutcome({ outcome: { type: 'error', explanation: 'x', error: 'RetryableError', errorSchema: anything } }, envelope))
            .toMatchObject({ errorSchema: anything })
        expect(() => parseProviderOutcome({ outcome: { type: 'resultTool', explanation: 'x', toolName: 'unregistered', input: anything } }, envelope))
            .toThrow('Invalid investigation outcome')
    })
})
