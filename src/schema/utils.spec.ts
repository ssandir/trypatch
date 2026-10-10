import { z } from 'zod/v4'
import { TrypatchFatalError } from '../errors'
import { extractJsonFromText, parseWithSchema, toJsonSchemaObject } from './utils'

describe('schemaUtils', () => {
    const schema = z.object({
        inStock: z.boolean(),
    })

    it('should convert zod schemas to json schema objects', () => {
        const jsonSchema = toJsonSchemaObject(schema, 'resultSchema')
        expect(jsonSchema).toMatchObject({
            type: 'object',
            properties: {
                inStock: { type: 'boolean' },
            },
        })
    })

    it('should throw a fatal error naming the option when a zod schema has a transform', () => {
        const withTransform = z.object({ count: z.string().transform(Number) })

        expect(() => toJsonSchemaObject(withTransform, 'resultSchema')).toThrow(TrypatchFatalError)
        expect(() => toJsonSchemaObject(withTransform, 'resultSchema')).toThrow(/^resultSchema can't be converted to JSON Schema: Transforms cannot be represented/)
    })

    it('should parse values with a zod schema', () => {
        expect(parseWithSchema(schema, { inStock: true })).toEqual({
            inStock: true,
        })
    })

    it('should parse a JSON-encoded string when no schema is given', () => {
        expect(parseWithSchema(undefined, '{"inStock":true}')).toEqual({
            inStock: true,
        })
    })

    it('should extract json from fenced text', () => {
        expect(extractJsonFromText('```json\n{"inStock":false}\n```')).toEqual({
            inStock: false,
        })
    })
})
