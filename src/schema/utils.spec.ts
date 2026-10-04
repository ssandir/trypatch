import { z } from 'zod'
import { extractJsonFromText, parseWithSchema, toJsonSchemaObject } from './utils'

describe('schemaUtils', () => {
    const schema = z.object({
        inStock: z.boolean(),
    })

    it('should convert zod schemas to json schema objects', () => {
        const jsonSchema = toJsonSchemaObject(schema)
        expect(jsonSchema).toMatchObject({
            type: 'object',
            properties: {
                inStock: { type: 'boolean' },
            },
        })
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
