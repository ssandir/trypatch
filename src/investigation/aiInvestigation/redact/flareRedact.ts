import { createVault, type Vault, type VaultOptions } from 'flare-redact'

export type InvestigationPrompts = {
    systemPrompt: string
    userPrompt: string
}

export type RedactedInvestigationPrompts = {
    prompts: InvestigationPrompts
    vault: Vault | undefined
}

export function redactInvestigationPrompts (
    prompts: InvestigationPrompts,
    options: VaultOptions | false | undefined,
): RedactedInvestigationPrompts {
    if (options === false) {
        return { prompts, vault: undefined }
    }

    const vault = createVault(options)

    return {
        prompts: {
            systemPrompt: String(vault.redact(prompts.systemPrompt)),
            userPrompt: String(vault.redact(prompts.userPrompt)),
        },
        vault,
    }
}

export function restoreInvestigationResponse<T> (
    value: T,
    vault: Vault | undefined,
): T {
    if (!vault) {
        return value
    }

    return vault.restore(value)
}
