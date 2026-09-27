import { z } from 'zod'
import { extractJsonFromText, parseWithSchema, toJsonSchemaObject } from './utils'

describe('schemaUtils', () => {
    const schema = z.object({
        rootCause: z.string(),
        retryable: z.boolean(),
    })

    it('should convert zod schemas to json schema objects', () => {
        const jsonSchema = toJsonSchemaObject(schema)
        expect(jsonSchema).toMatchObject({
            type: 'object',
            properties: {
                rootCause: { type: 'string' },
                retryable: { type: 'boolean' },
            },
        })
    })

    it('should parse zod investigation results', () => {
        expect(parseWithSchema(schema, { rootCause: 'timeout', retryable: true })).toEqual({
            rootCause: 'timeout',
            retryable: true,
        })
    })

    it('should parse a JSON-encoded string when no schema is given', () => {
        expect(parseWithSchema(undefined, '{"rootCause":"timeout","retryable":true}')).toEqual({
            rootCause: 'timeout',
            retryable: true,
        })
    })

    it('should extract json from fenced text', () => {
        expect(extractJsonFromText('```json\n{"rootCause":"x","retryable":false}\n```')).toEqual({
            rootCause: 'x',
            retryable: false,
        })
    })
})
