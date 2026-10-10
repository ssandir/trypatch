import { formatForLLM } from './formatForLLM'

describe('formatForLLM', () => {
    it('should include own properties and the cause chain', () => {
        const connectError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
            code: 'ECONNREFUSED',
            port: 5432,
        })

        const formatted = formatForLLM(new TypeError('fetch failed', { cause: connectError }))

        expect(formatted).toContain('TypeError: fetch failed')
        expect(formatted).toContain('[cause]: Error: connect ECONNREFUSED 127.0.0.1:5432')
        expect(formatted).toContain('code: \'ECONNREFUSED\'')
    })

    it('should include each error of an AggregateError', () => {
        const formatted = formatForLLM(new AggregateError([new Error('ipv6 refused'), new Error('ipv4 refused')], ''))

        expect(formatted).toContain('Error: ipv6 refused')
        expect(formatted).toContain('Error: ipv4 refused')
    })

    it('should inspect thrown non-errors, keeping their class name', () => {
        class HttpException {
            constructor (readonly status: number) {}
        }

        expect(formatForLLM(new HttpException(503))).toBe('HttpException { status: 503 }')
    })

    it('should format circular values and BigInt instead of throwing', () => {
        const request: Record<string, unknown> = { path: '/quotes' }
        request.self = request

        expect(formatForLLM([request, 10n])).toBe('[ <ref *1> { path: \'/quotes\', self: [Circular *1] }, 10n ]')
    })

    it('should keep Map and Set contents, class names and undefined', () => {
        class Money {
            constructor (readonly cents: number) {}
        }

        expect(formatForLLM([new Map([['sku', 1]]), new Set(['a']), new Money(5), undefined]))
            .toBe('[ Map(1) { \'sku\' => 1 }, Set(1) { \'a\' }, Money { cents: 5 }, undefined ]')
    })

    it('should cap long strings, arrays and buffers', () => {
        const formatted = formatForLLM(['x'.repeat(100_000), Array.from({ length: 10_000 }, (_, index) => index), Buffer.alloc(1_000_000)])

        expect(formatted.length).toBeLessThan(3_000)
        expect(formatted).toContain('more characters')
        expect(formatted).toContain('more items')
        expect(formatted).toContain('more bytes')
    })
})
