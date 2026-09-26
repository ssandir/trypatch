import { handleError } from './handleError'
import { Logger } from './logger'
import type { SchemaInfer, Schema, TryPatchOptions } from './trypatchOptions'

export function trypatch<
    S extends Schema,
    C = unknown,
> (options: TryPatchOptions<S, C>) {
    const logging = 'aiInvestigation' in options
        ? options.aiInvestigation.logging
        : options.customInvestigation.logging
    const logger = new Logger(logging)

    return function trypatchDecorator<
        This,
        Args extends unknown[],
        Return extends SchemaInfer<S> | Promise<SchemaInfer<S>>,
    > (
        originalMethod: (this: This, ...args: Args) => Return,
        context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
    ): (this: This, ...args: Args) => Return {
        if (context.kind !== 'method') {
            throw new TypeError('trypatch can only decorate methods')
        }

        const method = originalMethod as (...args: unknown[]) => unknown
        const methodContext = context as ClassMethodDecoratorContext<unknown, (...args: unknown[]) => unknown>

        return function trypatchedMethod (this: This, ...args: Args): Return {
            return Promise.resolve()
                .then(() => originalMethod.apply(this, args))
                .catch((error: unknown) => handleError(
                    error,
                    options,
                    logger,
                    methodContext,
                    method,
                    args,
                ) as Promise<Return>) as Return
        }
    }
}
