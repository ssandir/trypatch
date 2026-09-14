import { handleError } from './handleError'
import { Logger } from './logger'
import type { InferResult, ResultSchema, TryPatchOptions } from './trypatchOptions'

export function trypatch<
    S extends ResultSchema,
    C = unknown,
> (options: TryPatchOptions<S, C>) {
    const logger = new Logger(options.logging)

    return function trypatchDecorator<
        This,
        Args extends unknown[],
        Return extends InferResult<S> | Promise<InferResult<S>>,
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
