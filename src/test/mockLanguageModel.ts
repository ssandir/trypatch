import { MockLanguageModelV4 } from 'ai/test'

export type MockGenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>
export type MockCallOptions = MockLanguageModelV4['doGenerateCalls'][number]

export function mockTurn (content: MockGenerateResult['content']): MockGenerateResult {
    return {
        content,
        finishReason: {
            unified: content.some(part => part.type === 'tool-call') ? 'tool-calls' : 'stop',
            raw: undefined,
        },
        usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
    }
}

export function mockToolCallTurn (toolName: string, input: unknown, toolCallId = 'call-1'): MockGenerateResult {
    return mockTurn([{ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) }])
}

export function mockOutcomeTurn (outcome: unknown): MockGenerateResult {
    return mockTurn([{ type: 'text', text: JSON.stringify({ outcome }) }])
}

export function mockLanguageModel (
    ...turns: MockGenerateResult[]
): MockLanguageModelV4 {
    return new MockLanguageModelV4({ doGenerate: turns })
}

export function promptText (call: MockCallOptions | undefined, role: 'system' | 'user'): string {
    return JSON.stringify(call?.prompt.filter(message => message.role === role).map(message => message.content))
}
