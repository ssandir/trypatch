import { trypatch } from '@ssandir/trypatch'
import { secrets } from './shared'

export class IncidentService {
    @trypatch({
        aiInvestigation: {
            investigationProvider: { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY! },
            // #region mcp-servers
            mcpServers: [
                {
                    name: 'grafana',
                    type: 'http', // or 'sse'
                    url: 'https://mcp.internal/grafana',
                    headers: async () => ({ Authorization: `Bearer ${await secrets.get('grafana-token')}` }),
                    allowedTools: ['query_logs', 'get_dashboard'],
                },
                {
                    name: 'db',
                    type: 'stdio',
                    command: 'npx',
                    args: ['some-db-mcp'],
                    env: { DATABASE_URL: process.env.READONLY_DATABASE_URL! },
                },
            ],
            // #endregion mcp-servers
        },
    })
    async summarize (incidentId: string): Promise<string> {
        return await Promise.resolve(incidentId)
    }
}
