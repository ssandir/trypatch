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
