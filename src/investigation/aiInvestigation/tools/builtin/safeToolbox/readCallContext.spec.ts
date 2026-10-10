import { callTool } from '../../tool'
import { createReadCallContextTool } from './readCallContext'
import type { CallContext } from './types'

async function read (callContext: CallContext, root: 'error' | 'args', path: (string | number)[]): Promise<string> {
    return await callTool(createReadCallContextTool(callContext), { root, path }, undefined, { signal: undefined })
}

describe('read_call_context tool', () => {
    it('reads the root itself as deep as the prompt does, so deeper levels need another call', async () => {
        const callContext = { error: new Error('boom'), args: [{ a: { b: { c: { d: { e: 'deep' } } } } }] }

        await expect(read(callContext, 'args', [])).resolves.toContain('[Object]')
        await expect(read(callContext, 'args', [0, 'a', 'b'])).resolves.toBe('{ c: { d: { e: \'deep\' } } }')
    })

    it('follows property names and array indexes through the error', async () => {
        const error = new Error('parse failed', { cause: { issues: [{ path: ['eta_days'], code: 'invalid_type' }] } })

        await expect(read({ error, args: [] }, 'error', ['cause', 'issues', 0, 'code'])).resolves.toBe('invalid_type')
    })

    it('returns a string as plain text, so a stack reads line by line', async () => {
        const error = new Error('boom')

        await expect(read({ error, args: [] }, 'error', ['stack'])).resolves.toBe(error.stack)
    })

    it('reads Map entries by key and Set entries by index', async () => {
        const callContext = { error: new Error('boom'), args: [new Map([['sku', 'A-1']]), new Set(['first', 'second'])] }

        await expect(read(callContext, 'args', [0, 'sku'])).resolves.toBe('A-1')
        await expect(read(callContext, 'args', [1, 1])).resolves.toBe('second')
    })

    it('ignores overridden Map methods, since they are application code', async () => {
        const get = jest.fn(() => 'overridden')
        class TrackedMap extends Map<string, string> {
            override get = get
        }

        await expect(read({ error: new Error('boom'), args: [new TrackedMap([['sku', 'A-1']])] }, 'args', [0, 'sku'])).resolves.toBe('A-1')
        expect(get).not.toHaveBeenCalled()
    })

    it('does not invoke getters', async () => {
        const getter = jest.fn(() => 'secret')
        const error = Object.defineProperty(new Error('boom'), 'token', { get: getter })

        await expect(read({ error, args: [] }, 'error', ['token'])).rejects.toThrow('Cannot read .token of error: it is a getter, which is not invoked')
        expect(getter).not.toHaveBeenCalled()
    })

    it('does not read through a Proxy, so its traps never run', async () => {
        const trap = jest.fn()
        const proxy = new Proxy({ id: 1 }, { get: trap, getOwnPropertyDescriptor: trap })

        await expect(read({ error: new Error('boom'), args: [proxy] }, 'args', [0, 'id'])).rejects.toThrow('Cannot read .id of args[0]: it is a Proxy, which is not read')
        expect(trap).not.toHaveBeenCalled()
    })

    it('reads only own properties, so a Proxy in the prototype chain is never touched', async () => {
        const trap = jest.fn()
        const value = Object.create(new Proxy<object>({}, { getOwnPropertyDescriptor: trap })) as object

        await expect(read({ error: new Error('boom'), args: [value] }, 'args', [0, 'id'])).rejects.toThrow('Cannot read .id of args[0]: it has no such property')
        expect(trap).not.toHaveBeenCalled()
    })

    it('names exactly where reading the path stopped', async () => {
        const callContext = {
            error: new Error('boom'),
            args: [{ order: null, count: 3, items: ['a'], byId: new Map([['a', 1]]), tags: new Set(['x']) }],
        }

        await expect(read(callContext, 'args', [0, 'missing', 'id'])).rejects.toThrow('Cannot read .missing of args[0]: it has no such property')
        await expect(read(callContext, 'args', [0, 'order', 'id'])).rejects.toThrow('Cannot read .id of args[0].order: it is null')
        await expect(read(callContext, 'args', [0, 'count', 'x'])).rejects.toThrow('Cannot read .x of args[0].count: it is a number')
        await expect(read(callContext, 'args', [0, 'items', 3, 'name'])).rejects.toThrow('Cannot read [3] of args[0].items: it has 1 items')
        await expect(read(callContext, 'args', [0, 'byId', 'b'])).rejects.toThrow('Cannot read .b of args[0].byId: the Map has no such key')
        await expect(read(callContext, 'args', [0, 'tags', 1])).rejects.toThrow('Cannot read [1] of args[0].tags: the Set has 1 entries, read by index')
    })
})
