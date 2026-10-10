import type { InvestigationContext } from '../../../types'
import { buildInvestigationPrompt } from './buildPrompt'

describe('buildInvestigationPrompt', () => {
    const ctx: InvestigationContext = {
        error: new Error('boom'),
        methodName: 'charge',
        methodSource: 'charge(cardId) { return this.gateway.charge(cardId) }',
        args: ['card-1'],
        methodMetadata: { static: false, private: false },
        timing: { startedAt: new Date('2026-10-09T08:15:00.000Z'), durationMs: 30_012 },
    }

    it('should include method and error details but not the outcome schema in the default prompt', () => {
        const prompts = buildInvestigationPrompt(ctx, ctx.args, {})
        expect(prompts.userPrompt).toContain('Method: charge')
        expect(prompts.userPrompt).toContain('boom')
        expect(prompts.userPrompt).not.toContain('Return JSON matching this schema')
    })

    it('should include class name and method metadata in the default prompt', () => {
        const prompts = buildInvestigationPrompt({
            ...ctx,
            methodMetadata: { className: 'BillingService', static: true, private: true },
        }, ctx.args, {})
        expect(prompts.userPrompt).toContain('Method: BillingService.charge')
        expect(prompts.userPrompt).toContain('Method metadata: {"className":"BillingService","static":true,"private":true}')
    })

    it('should include when the call started and how long it ran', () => {
        expect(buildInvestigationPrompt(ctx, ctx.args, {}).userPrompt)
            .toContain('Call started at 2026-10-09T08:15:00.000Z and failed after 30012 ms')
    })

    it('should pass sanitized args to a custom prompt function', () => {
        const prompt = jest.fn((promptCtx: InvestigationContext) => `args: ${String(promptCtx.args)}`)

        const prompts = buildInvestigationPrompt(ctx, ['card-****'], { prompt })

        expect(prompts.userPrompt).toBe('args: card-****')
        expect(prompt).toHaveBeenCalledWith({ ...ctx, args: ['card-****'] })
    })

    it('should leave the method source out of the default prompt unless allowMethodSource is set', () => {
        expect(buildInvestigationPrompt(ctx, ctx.args, {}).userPrompt)
            .not.toContain(ctx.methodSource)
        expect(buildInvestigationPrompt(ctx, ctx.args, { allowMethodSource: true }).userPrompt)
            .toContain(`Method source (as loaded at runtime, so it may be compiled or minified):\n${ctx.methodSource}`)
    })
})
