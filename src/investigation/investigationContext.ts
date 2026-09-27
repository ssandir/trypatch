import type { InvestigationContext, MethodDescriptor } from '../types'

/** Stage-3 decoration time has no class reference at all, so this must run at call time to cover both dialects. */
function resolveClassName (receiver: unknown): string | undefined {
    if (typeof receiver === 'function') {
        return receiver.name || undefined
    }
    if (receiver !== null && typeof receiver === 'object') {
        const constructorName = (receiver as { constructor?: { name?: string } }).constructor?.name
        return constructorName && constructorName !== 'Object' ? constructorName : undefined
    }
    return undefined
}

export function buildInvestigationContext (
    error: unknown,
    methodDescriptor: MethodDescriptor,
    receiver: unknown,
    args: unknown[],
): InvestigationContext {
    const className = resolveClassName(receiver)

    return {
        error,
        methodName: String(methodDescriptor.name),
        args,
        methodMetadata: {
            ...className !== undefined ? { className } : {},
            static: methodDescriptor.static,
            private: methodDescriptor.private,
        },
    }
}
