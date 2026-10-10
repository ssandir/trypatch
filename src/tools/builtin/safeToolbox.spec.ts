import { setTimeout as sleep } from 'node:timers/promises'
import { $ZodError } from 'zod/v4/core'
import { callTool, defineTool } from '../tool'
import { safeToolbox, withSafeToolbox } from './safeToolbox'

jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }))

describe('safeToolbox', () => {
    describe('wait tool', () => {
        const waitTool = safeToolbox.find(tool => tool.name === 'trypatch_builtin_wait')!

        it('waits for the given duration with the tool signal', async () => {
            const controller = new AbortController()

            await expect(callTool(waitTool, { durationMs: 1_500 }, undefined, { signal: controller.signal }))
                .resolves.toBe('Waited 1500ms')
            expect(sleep).toHaveBeenCalledWith(1_500, undefined, { signal: expect.any(AbortSignal) })
        })

        it.each([
            ['a negative', -1],
            ['an infinite', Infinity],
            ['a fractional', 1.5],
            ['an over-10-minute', 600_001],
        ])('rejects %s duration', async (_label, durationMs) => {
            await expect(callTool(waitTool, { durationMs }, undefined, { signal: undefined }))
                .rejects.toBeInstanceOf($ZodError)
        })
    })

    describe('withSafeToolbox', () => {
        const lookupTool = defineTool({
            name: 'lookup_order',
            description: 'Look up an order',
            execute: (): string => 'order',
        })

        it('puts the safe toolbox ahead of the investigation tools by default', () => {
            expect(withSafeToolbox([lookupTool])).toEqual([...safeToolbox, lookupTool])
            expect(withSafeToolbox(undefined)).toEqual(safeToolbox)
        })

        it('leaves the investigation tools alone when the safe toolbox is not allowed', () => {
            expect(withSafeToolbox([lookupTool], false)).toEqual([lookupTool])
            expect(withSafeToolbox(undefined, false)).toBeUndefined()
        })
    })
})
