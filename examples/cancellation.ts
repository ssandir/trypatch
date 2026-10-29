import { trypatch } from '@ssandir/trypatch'
import { reportClient, shutdownController, type Report } from './shared'

// #region cancellation
export class ReportService {
    @trypatch({
        getSignal: ctx => (ctx.args[1] as { signal?: AbortSignal } | undefined)?.signal,
        timeoutMs: 60_000,
        aiInvestigation: {
            investigationProvider: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY! },
        },
    })
    async generate (reportId: string, options?: { signal?: AbortSignal }): Promise<Report> {
        return await reportClient.generate(reportId, options)
    }
}
// #endregion cancellation

export const shutdownOptions = {
    // #region shutdown
    getSignal: () => shutdownController.signal,
    // #endregion shutdown
}
