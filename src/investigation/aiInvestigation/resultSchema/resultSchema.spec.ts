import { z } from 'zod'
import { buildInvestigationResultSchema } from './resultSchema'
import { TrypatchConfigError } from '../../../errors'
import { Tool } from '../../../tools'
import type { CustomErrorDefinition } from '../../../types'

function outcomeVariants (outcomeSchema: ReturnType<typeof buildInvestigationResultSchema>) {
    const outcome = outcomeSchema.properties.outcome as { anyOf?: unknown[], properties?: { type: { enum: string[] } } }
    return outcome.anyOf ?? [outcome]
}

function variantTypes (outcomeSchema: ReturnType<typeof buildInvestigationResultSchema>): string[] {
    return outcomeVariants(outcomeSchema).map(variant => (variant as { properties: { type: { enum: string[] } } }).properties.type.enum[0]!)
}

describe('buildInvestigationResultSchema', () => {
    const resultTool = new Tool({
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

    it('should include the result variant by default', () => {
        const schema = buildInvestigationResultSchema({})
        expect(variantTypes(schema)).toEqual(['result'])
    })

    it('should describe the result as a JSON-encoded string when no resultSchema is given', () => {
        const schema = buildInvestigationResultSchema({})
        const [variant] = outcomeVariants(schema) as { properties: { result: unknown } }[]
        expect(variant!.properties.result).toMatchObject({ type: 'string' })
    })

    it('should include the result variant when allowDirectResultCreation is explicitly true', () => {
        const schema = buildInvestigationResultSchema({ allowDirectResultCreation: true })
        expect(variantTypes(schema)).toEqual(['result'])
    })

    it('should exclude the result variant when allowDirectResultCreation is false and a result tool is provided', () => {
        const schema = buildInvestigationResultSchema({ allowDirectResultCreation: false, resultTools: [resultTool] })
        expect(variantTypes(schema)).toEqual(['resultTool'])
    })

    it('should exclude the result variant when allowDirectResultCreation is false and a custom error is provided', () => {
        const schema = buildInvestigationResultSchema({ allowDirectResultCreation: false, customErrors })
        expect(variantTypes(schema)).toEqual(['error'])
    })

    it('should throw when allowDirectResultCreation is false with no result tools or custom errors', () => {
        expect(() => buildInvestigationResultSchema({ allowDirectResultCreation: false }))
            .toThrow(TrypatchConfigError)
        expect(() => buildInvestigationResultSchema({ allowDirectResultCreation: false }))
            .toThrow('AI investigation has no possible outcome')
    })
})
