import { types } from 'node:util'
import { z } from 'zod/v4'
import { formatForLLM } from '../../../prompt/formatForLLM'
import { defineTool } from '../../tool'
import { BUILTIN_TOOL_NAME_PREFIX } from '../constants'
import type { CallContext } from './types'

// The model asked for this one value, so it gets more room.
const MAX_STRING_LENGTH = 50_000
const MAX_ARRAY_LENGTH = 200

type PathSegment = string | number

function formatSegment (segment: PathSegment): string {
    return typeof segment === 'number' ? `[${segment}]` : `.${segment}`
}

function formatPath ([root, ...rest]: PathSegment[]): string {
    return String(root ?? '') + rest.map(formatSegment).join('')
}

function throwCannotRead (resolvedPath: PathSegment[], segment: PathSegment, reason: string): never {
    throw new Error(`Cannot read ${formatSegment(segment)} of ${formatPath(resolvedPath)}: ${reason}`)
}

// `resolvedPath` is where `value` sits, so an error names exactly where the read stopped.
function readSegment (value: unknown, resolvedPath: PathSegment[], segment: PathSegment): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        throwCannotRead(resolvedPath, segment, `it is ${value === null || value === undefined ? String(value) : `a ${typeof value}`}`)
    }

    // Getters, proxy traps and overridden Map/Set methods are application code, which this tool must not run.
    if (types.isProxy(value)) {
        throwCannotRead(resolvedPath, segment, 'it is a Proxy, which is not read')
    }

    if (types.isMap(value)) {
        if (!Map.prototype.has.call(value, segment)) {
            throwCannotRead(resolvedPath, segment, 'the Map has no such key')
        }
        return Map.prototype.get.call(value, segment)
    }

    if (types.isSet(value)) {
        const entries = Array.from(Set.prototype.values.call(value))
        if (typeof segment !== 'number' || segment >= entries.length) {
            throwCannotRead(resolvedPath, segment, `the Set has ${entries.length} entries, read by index`)
        }
        return entries[segment]
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, segment)
    if (descriptor === undefined) {
        throwCannotRead(resolvedPath, segment, Array.isArray(value) ? `it has ${value.length} items` : 'it has no such property')
    }

    if ('value' in descriptor) {
        return descriptor.value
    }

    // V8 defines an error's `stack` as an accessor.
    if (value instanceof Error && segment === 'stack') {
        return value.stack
    }

    throwCannotRead(resolvedPath, segment, 'it is a getter, which is not invoked')
}

function resolvePath (value: unknown, remainingPath: PathSegment[], resolvedPath: PathSegment[] = []): unknown {
    const [segment, ...rest] = remainingPath
    if (segment === undefined) {
        return value
    }

    return resolvePath(readSegment(value, resolvedPath, segment), rest, [...resolvedPath, segment])
}

export function createReadCallContextTool (callContext: CallContext) {
    return defineTool({
        name: `${BUILTIN_TOOL_NAME_PREFIX}read_call_context`,
        description: 'Shows part of the failed call\'s error or arguments that the prompt cut short, e.g. shown as [Object], [Array], "... more items" or "... more characters". Getters are not invoked.',
        parameters: z.object({
            root: z.enum(['error', 'args']),
            path: z.array(z.union([z.string(), z.number().int().min(0)]))
                .describe('Property names and array indexes from the root, e.g. ["cause", "issues", 0] for error.cause.issues[0]. Empty for the root itself.'),
        }),
        execute: ({ root, path }): string => {
            const value = resolvePath(callContext, [root, ...path])
            // inspect would quote a string and split it into concatenated lines, which is hard to read for a stack.
            if (typeof value === 'string') {
                return value.slice(0, MAX_STRING_LENGTH)
            }

            return formatForLLM(value, Array.isArray(value) ? { maxArrayLength: MAX_ARRAY_LENGTH } : undefined)
        },
    })
}
