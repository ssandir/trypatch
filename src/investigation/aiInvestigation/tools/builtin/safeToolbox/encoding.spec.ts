import { callTool } from '../../tool'
import { decodeTool, encodeTool } from './encoding'

type Encoding = 'base64' | 'base64url' | 'hex' | 'jwt'

async function decode (encoding: Encoding, value: string): Promise<unknown> {
    return await callTool(decodeTool, { encoding, value }, undefined, { signal: undefined })
}

function jwt (header: object, payload: object): string {
    return [header, payload].map(part => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.c2lnbmF0dXJl'
}

describe('encoding tools', () => {
    describe('decode', () => {
        it.each([
            ['base64', 'aMOpbGxvIPCfjI0='],
            ['base64url', 'aMOpbGxvIPCfjI0'],
            ['hex', '68c3a96c6c6f20f09f8c8d'],
        ] as const)('decodes %s to UTF-8 text', async (encoding, value) => {
            await expect(decode(encoding, value)).resolves.toBe('héllo 🌍')
        })

        it('ignores whitespace, e.g. line-wrapped base64', async () => {
            await expect(decode('base64', 'aMOpbGxv\nIPCfjI0=')).resolves.toBe('héllo 🌍')
        })

        it.each([
            ['base64', 'aGV$bG8='],
            ['base64url', 'aGV+bG8'],
            ['hex', 'abc'],
            ['hex', 'zz'],
        ] as const)('rejects invalid %s %p instead of decoding it to wrong bytes', async (encoding, value) => {
            await expect(decode(encoding, value)).rejects.toThrow(`Not valid ${encoding}`)
        })

        it('falls back to hex when the bytes are not UTF-8', async () => {
            await expect(decode('hex', 'ff00')).resolves.toBe('Decoded bytes are not valid UTF-8; as hex: ff00')
        })
    })

    describe('decode jwt', () => {
        const now = Date.parse('2026-10-10T12:00:00.000Z')
        const nowSeconds = now / 1000

        beforeEach(() => {
            jest.spyOn(Date, 'now').mockReturnValue(now)
        })

        afterEach(() => {
            jest.restoreAllMocks()
        })

        it('decodes the header and payload and reads its time claims against the current time', async () => {
            const token = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'user-1', iat: nowSeconds - 3_600, nbf: nowSeconds - 3_600, exp: nowSeconds - 60 })

            await expect(decode('jwt', token)).resolves.toEqual({
                header: { alg: 'HS256', typ: 'JWT' },
                payload: { sub: 'user-1', iat: nowSeconds - 3_600, nbf: nowSeconds - 3_600, exp: nowSeconds - 60 },
                times: {
                    exp: '2026-10-10T11:59:00.000Z',
                    nbf: '2026-10-10T11:00:00.000Z',
                    iat: '2026-10-10T11:00:00.000Z',
                },
                now: '2026-10-10T12:00:00.000Z',
                expired: true,
                notYetValid: false,
                signatureVerified: false,
            })
        })

        it('reports a token that is not valid yet', async () => {
            await expect(decode('jwt', jwt({ alg: 'HS256' }, { nbf: nowSeconds + 60, exp: nowSeconds + 3_600 })))
                .resolves.toMatchObject({ expired: false, notYetValid: true })
        })

        it('leaves out time checks for claims the token does not have', async () => {
            const decoded = await decode('jwt', jwt({ alg: 'none' }, { sub: 'user-1' }))

            expect(decoded).toMatchObject({ payload: { sub: 'user-1' }, times: {} })
            expect(decoded).not.toHaveProperty('expired')
            expect(decoded).not.toHaveProperty('notYetValid')
        })

        it('rejects a value without three parts', async () => {
            await expect(decode('jwt', 'header.payload')).rejects.toThrow('A JWT has 3 dot-separated parts, this value has 2')
        })

        it('rejects a part that is not base64url JSON', async () => {
            await expect(decode('jwt', `${Buffer.from('not json').toString('base64url')}.e30.sig`)).rejects.toThrow(SyntaxError)
        })
    })

    describe('encode', () => {
        it.each([
            ['base64', 'aMOpbGxvIPCfjI0='],
            ['base64url', 'aMOpbGxvIPCfjI0'],
            ['hex', '68c3a96c6c6f20f09f8c8d'],
        ] as const)('encodes UTF-8 text as %s', async (encoding, expected) => {
            await expect(callTool(encodeTool, { encoding, value: 'héllo 🌍' }, undefined, { signal: undefined })).resolves.toBe(expected)
        })
    })
})
