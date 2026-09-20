import type { ApiKeyAuth } from '../../auth'
import { Providers } from '../types'

export type CursorRepositoryConfig = {
    url: string
    startingRef?: string
    prUrl?: string
}

export type CursorInvestigationConfig = {
    provider: typeof Providers.CURSOR
    auth: ApiKeyAuth
    baseURL?: string
    model?: string | { id: string, params?: { id: string, value: string | boolean | number }[] }
    repository?: CursorRepositoryConfig
    pollIntervalMs?: number
}

export type CursorCreateAgentResponse = {
    agent?: {
        id?: string
    }
    run?: {
        id?: string
    }
    error?: {
        message?: string
    }
}

export type CursorRunResponse = {
    id?: string
    status?: string
    result?: string
    error?: {
        message?: string
    }
}
