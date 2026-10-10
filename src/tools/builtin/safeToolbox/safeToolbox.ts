import type { InvestigationTool } from '../../../types'
import { decodeTool, encodeTool } from './encoding'
import { createReadCallContextTool } from './readCallContext'
import type { CallContext } from './types'
import { waitTool } from './wait'

export function createSafeToolbox (callContext: CallContext): InvestigationTool[] {
    return [waitTool, createReadCallContextTool(callContext), decodeTool, encodeTool]
}

export function withSafeToolbox<C> (
    callContext: CallContext,
    investigationTools: InvestigationTool<C>[] | undefined,
    allowSafeToolbox = true,
): InvestigationTool<C>[] | undefined {
    return allowSafeToolbox ? [...createSafeToolbox(callContext), ...investigationTools ?? []] : investigationTools
}
