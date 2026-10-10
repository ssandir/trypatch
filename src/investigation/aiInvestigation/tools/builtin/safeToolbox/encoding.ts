import { z } from 'zod/v4'
import { defineTool } from '../../tool'
import { BUILTIN_TOOL_NAME_PREFIX } from '../constants'

const MAX_INPUT_LENGTH = 10_000

// Buffer.from skips characters outside the alphabet, which would turn a malformed value into silently wrong bytes.
const ENCODED_PATTERNS = {
    base64: /^[A-Za-z0-9+/]*={0,2}$/,
    base64url: /^[A-Za-z0-9_-]*={0,2}$/,
    hex: /^(?:[0-9a-fA-F]{2})*$/,
} as const

type ByteEncoding = keyof typeof ENCODED_PATTERNS

function decodeBytes (value: string, encoding: ByteEncoding): Buffer {
    const trimmed = value.replace(/\s/g, '')
    if (!ENCODED_PATTERNS[encoding].test(trimmed)) {
        throw new Error(`Not valid ${encoding}`)
    }
    return Buffer.from(trimmed, encoding)
}

function bytesToText (bytes: Buffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return `Decoded bytes are not valid UTF-8; as hex: ${bytes.toString('hex')}`
    }
}

const TIME_CLAIMS = ['exp', 'nbf', 'iat'] as const

function decodeJwt (token: string): unknown {
    const parts = token.trim().split('.')
    if (parts.length !== 3) {
        throw new Error(`A JWT has 3 dot-separated parts, this value has ${parts.length}`)
    }

    const [header, payload] = parts.slice(0, 2).map(part => JSON.parse(decodeBytes(part, 'base64url').toString('utf8')) as unknown) as [unknown, Record<string, unknown>]
    const now = Date.now()
    const times = Object.fromEntries(TIME_CLAIMS
        .filter(claim => typeof payload[claim] === 'number')
        .map(claim => [claim, new Date((payload[claim] as number) * 1000).toISOString()]))

    return {
        header,
        payload,
        // The model can't tell the current time, so it can't compare these itself.
        times,
        now: new Date(now).toISOString(),
        ...typeof payload.exp === 'number' ? { expired: payload.exp * 1000 <= now } : {},
        ...typeof payload.nbf === 'number' ? { notYetValid: payload.nbf * 1000 > now } : {},
        signatureVerified: false,
    }
}

export const decodeTool = defineTool({
    name: `${BUILTIN_TOOL_NAME_PREFIX}decode`,
    description: 'Decodes base64, base64url or hex to UTF-8 text, or a JWT into its header and payload with its time claims as dates. The JWT signature is not verified.',
    parameters: z.object({
        encoding: z.enum(['base64', 'base64url', 'hex', 'jwt']),
        value: z.string().max(MAX_INPUT_LENGTH),
    }),
    execute: ({ encoding, value }): unknown => {
        return encoding === 'jwt' ? decodeJwt(value) : bytesToText(decodeBytes(value, encoding))
    },
})

export const encodeTool = defineTool({
    name: `${BUILTIN_TOOL_NAME_PREFIX}encode`,
    description: 'Encodes UTF-8 text as base64, base64url or hex.',
    parameters: z.object({
        encoding: z.enum(['base64', 'base64url', 'hex']),
        value: z.string().max(MAX_INPUT_LENGTH),
    }),
    execute: ({ encoding, value }): string => Buffer.from(value, 'utf8').toString(encoding),
})
