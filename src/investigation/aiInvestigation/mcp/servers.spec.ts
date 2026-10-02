import { TrypatchConfigError } from '../../../errors'
import { validateMcpServers } from './servers'

describe('mcp servers', () => {
    describe('validateMcpServers', () => {
        const grafana = { name: 'grafana', type: 'http', url: 'https://mcp.internal/grafana' } as const

        it('should accept valid servers and no servers', () => {
            expect(() => validateMcpServers(undefined, 'claude')).not.toThrow()
            expect(() => validateMcpServers([
                { ...grafana, allowedTools: ['query_logs'] },
                { name: 'db-2', type: 'stdio', command: 'npx' },
            ], 'openai')).not.toThrow()
        })

        it('should reject names that cannot be used as a tool prefix', () => {
            expect(() => validateMcpServers([{ ...grafana, name: 'my grafana' }], 'claude'))
                .toThrow(TrypatchConfigError)
        })

        it('should reject duplicate names', () => {
            expect(() => validateMcpServers([grafana, grafana], 'claude'))
                .toThrow('MCP server name "grafana" is used more than once')
        })

        it('should reject invalid urls and urls with credentials', () => {
            expect(() => validateMcpServers([{ ...grafana, url: 'not a url' }], 'claude'))
                .toThrow('MCP server "grafana" has an invalid url')
            expect(() => validateMcpServers([{ ...grafana, url: 'https://user:pass@mcp.internal' }], 'claude'))
                .toThrow('pass credentials through headers')
        })

        it('should reject allowedTools with cursor', () => {
            expect(() => validateMcpServers([{ ...grafana, allowedTools: ['query_logs'] }], 'cursor'))
                .toThrow('allowedTools is not supported by the cursor provider')
            expect(() => validateMcpServers([grafana], 'cursor')).not.toThrow()
        })
    })
})
