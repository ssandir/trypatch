import { z } from 'zod/v4'
import { jsonResponse, requestBody } from '../../../../test/fetch'
import { buildInvestigationResultSchema } from '../../resultSchema'
import { investigateWithLanguageModel } from './investigate'

// Unlike investigate.spec.ts, createLanguageModel isn't mocked: each provider config runs the real AI SDK provider against a mocked fetch.
describe('createLanguageModel', () => {
    const outcomeSchema = buildInvestigationResultSchema({
        resultSchema: z.object({ inStock: z.boolean() }),
    })
    const outcomeText = JSON.stringify({
        outcome: { type: 'result', explanation: 'test explanation', result: { inStock: true } },
    })
    const prompts = { systemPrompt: 'Investigate', userPrompt: 'Something failed' }

    const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn()

    afterEach(() => {
        fetchMock.mockReset()
    })

    it('should call Claude through the custom fetch and return the parsed outcome', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            content: [{ type: 'text', text: outcomeText }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10 },
        }))

        const result = await investigateWithLanguageModel(
            { provider: 'claude', apiKey: 'anthropic-key', fetch: fetchMock },
            outcomeSchema,
            prompts,
            {},
        )

        expect(result).toEqual({
            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: true } },
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.anthropic.com/v1/messages',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'x-api-key': 'anthropic-key' }),
            }),
        )
        expect(requestBody(fetchMock).model).toBe('claude-sonnet-5')
    })

    it('should call OpenAI through the custom fetch and return the parsed outcome', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            id: 'resp_1',
            object: 'response',
            created_at: 1,
            model: 'gpt-5.5',
            output: [{
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: outcomeText, annotations: [] }],
            }],
            usage: { input_tokens: 10, output_tokens: 10 },
        }))

        const result = await investigateWithLanguageModel(
            { provider: 'openai', apiKey: 'test-key', fetch: fetchMock },
            outcomeSchema,
            prompts,
            {},
        )

        expect(result).toEqual({
            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: true } },
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.openai.com/v1/responses',
            expect.objectContaining({
                headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
            }),
        )
    })

    it('should call an OpenAI-compatible endpoint at its base URL', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            id: 'chatcmpl-1',
            object: 'chat.completion',
            created: 1,
            model: 'llama',
            choices: [{ index: 0, message: { role: 'assistant', content: outcomeText }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10 },
        }))

        const result = await investigateWithLanguageModel(
            {
                provider: 'openai-compatible',
                baseURL: 'http://localhost:11434/v1',
                model: 'llama',
                supportsStructuredOutputs: true,
                fetch: fetchMock,
            },
            outcomeSchema,
            prompts,
            {},
        )

        expect(result).toEqual({
            outcome: { type: 'result', explanation: 'test explanation', result: { inStock: true } },
        })
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.anything())
    })
})
