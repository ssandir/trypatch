import { createVault } from 'flare-redact'
import {
    redactInvestigationPrompts,
    restoreInvestigationResponse,
} from './flareRedact'

describe('flareRedact', () => {
    const prompts = {
        systemPrompt: 'Investigate errors.',
        userPrompt: 'Token sk-live-abcdefghijklmnopqrstuvwx failed for user@example.com',
    }

    it('should return prompts unchanged when redactConfig is false', () => {
        expect(redactInvestigationPrompts(prompts, false)).toEqual({
            prompts,
            vault: undefined,
        })
    })

    it('should redact secrets from both investigation prompts when redactConfig is undefined', () => {
        const { prompts: redacted, vault } = redactInvestigationPrompts(prompts, undefined)

        expect(redacted.userPrompt).not.toContain('sk-live-abcdefghijklmnopqrstuvwx')
        expect(redacted.userPrompt).not.toContain('user@example.com')
        expect(redacted.systemPrompt).toBe('Investigate errors.')
        expect(vault).toBeDefined()
    })

    it('should redact configured terms reversibly', () => {
        const secret = 'super-secret-api-key'
        const { prompts: redacted, vault } = redactInvestigationPrompts(
            {
                systemPrompt: 'Investigate.',
                userPrompt: `Authorization failed for ${secret}`,
            },
            { terms: [secret] },
        )

        expect(redacted.userPrompt).not.toContain(secret)
        expect(redacted.userPrompt).toMatch(/\[FR_CUSTOM_TERM_[0-9a-f]+\]/)
        expect(restoreInvestigationResponse(redacted.userPrompt, vault)).toContain(secret)
    })

    it('should redact secrets from the system prompt', () => {
        const { prompts: redacted } = redactInvestigationPrompts(
            {
                systemPrompt: 'Contact ada@example.com',
                userPrompt: 'Something failed',
            },
            {},
        )

        expect(redacted.systemPrompt).not.toContain('ada@example.com')
    })

    it('should restore structured provider responses', () => {
        const vault = createVault({
            terms: ['secret-value'],
        })
        const redacted = vault.redact({ rootCause: 'Failed with secret-value' })

        expect(restoreInvestigationResponse(redacted, vault)).toEqual({
            rootCause: 'Failed with secret-value',
        })
    })
})
