import type { CallTiming } from '../types'

export function mockCallTiming (): CallTiming {
    return { startedAt: new Date('2026-10-09T08:15:00.000Z'), durationMs: 120 }
}
