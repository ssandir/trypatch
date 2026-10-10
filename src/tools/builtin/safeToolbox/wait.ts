import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { defineTool } from '../../tool'
import { BUILTIN_TOOL_NAME_PREFIX } from '../constants'

// The decorated method's caller waits along with the AI. 10 min is a realistic upper bound for an AI investigation hold. 
const MAX_WAIT_MS = 10 * 60 * 1000

export const waitTool = defineTool({
    name: `${BUILTIN_TOOL_NAME_PREFIX}wait`,
    description: 'Wait for the given number of milliseconds before continuing, e.g. to let a rate limit reset or a transient failure clear before checking again.',
    parameters: z.object({
        durationMs: z.number().int().min(0).max(MAX_WAIT_MS).describe('How long to wait, in milliseconds.'),
    }),
    execute: async ({ durationMs }, _context, { signal }): Promise<string> => {
        await sleep(durationMs, undefined, { signal })
        return `Waited ${durationMs}ms`
    },
})
