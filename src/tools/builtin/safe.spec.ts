import { setTimeout as sleep } from 'node:timers/promises'
import { $ZodError } from 'zod/v4/core'
import { callTool } from '../tool'
import { safeTools } from './safe'

jest.mock('node:timers/promises', () => ({ setTimeout: jest.fn() }))

describe('wait tool', () => {
    const waitTool = safeTools.find(tool => tool.name === 'trypatch_builtin_wait')!

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
        ['a beyond-timer-limit', 2_147_483_648],
    ])('rejects %s duration', async (_label, durationMs) => {
        await expect(callTool(waitTool, { durationMs }, undefined, { signal: undefined }))
            .rejects.toBeInstanceOf($ZodError)
    })
})
