import { formatError } from './formatError'

describe('formatError', () => {
    it('should include own properties and the cause chain', () => {
        const connectError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
            code: 'ECONNREFUSED',
            port: 5432,
        })

        const formatted = formatError(new TypeError('fetch failed', { cause: connectError }))

        expect(formatted).toContain('TypeError: fetch failed')
        expect(formatted).toContain('[cause]: Error: connect ECONNREFUSED 127.0.0.1:5432')
        expect(formatted).toContain('code: \'ECONNREFUSED\'')
    })

    it('should include each error of an AggregateError', () => {
        const formatted = formatError(new AggregateError([new Error('ipv6 refused'), new Error('ipv4 refused')], ''))

        expect(formatted).toContain('Error: ipv6 refused')
        expect(formatted).toContain('Error: ipv4 refused')
    })

    it('should inspect thrown non-errors, keeping their class name', () => {
        class HttpException {
            constructor (readonly status: number) {}
        }

        expect(formatError(new HttpException(503))).toBe('HttpException { status: 503 }')
    })
})
