import type { InvestigationTool } from '../../types'
import { safeTools } from './safe'

export function withSafeTools<C> (
    investigationTools: InvestigationTool<C>[] | undefined,
    allowSafeTools = true,
): InvestigationTool<C>[] | undefined {
    return allowSafeTools ? [...safeTools, ...investigationTools ?? []] : investigationTools
}
