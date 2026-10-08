import type { MethodDescriptor } from '../types'

export function mockMethodDecoratorContext (
    name = 'run',
): ClassMethodDecoratorContext<unknown, (...args: unknown[]) => unknown> {
    return {
        kind: 'method',
        name,
        static: false,
        private: false,
        access: {
            has: (): boolean => true,
            get: (): (...args: unknown[]) => unknown => () => undefined,
        },
        metadata: {},
        addInitializer: (): void => {},
    }
}

export function mockMethodDescriptor (name = 'run'): MethodDescriptor {
    const context = mockMethodDecoratorContext(name)
    return {
        dialect: 'stage3',
        name: context.name,
        method: () => undefined,
        static: context.static,
        private: context.private,
        context,
    }
}
