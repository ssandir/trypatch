import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { defineTool } from '../tool'

// Node clamps a timer delay above 2^31 - 1 ms to 1ms, which would silently skip the wait.
const MAX_WAIT_MS = 2_147_483_647

const waitTool = defineTool({
    name: 'wait',
    description: 'Wait for the given number of milliseconds before continuing, e.g. to let a rate limit reset or a transient failure clear before checking again.',
    parameters: z.object({
        durationMs: z.number().int().min(0).max(MAX_WAIT_MS).describe('How long to wait, in milliseconds.'),
    }),
    execute: async ({ durationMs }, _context, { signal }): Promise<string> => {
        await sleep(durationMs, undefined, { signal })
        return `Waited ${durationMs}ms`
    },
})

export const safeTools = [waitTool]
