import { TrypatchFatalError } from './errors'
import { runInvestigation } from './investigation/runInvestigation'
import { Logger } from './logger'
import type { SchemaInfer, Schema } from './schema/types'
import type { AnyMethod, AnyMethodContext, MethodDescriptor, TryPatchOptions } from './types'

type LegacyMethodDecorator = (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
) => PropertyDescriptor | void

type Stage3MethodDecorator<S extends Schema> = <
    This,
    Args extends unknown[],
    Return extends Promise<SchemaInfer<S>>,
> (
    originalMethod: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => (this: This, ...args: Args) => Return

/**
 * Consumers may compile with TypeScript's legacy `experimentalDecorators` (still the default for
 * NestJS, TypeORM, etc.) or with the standard stage-3 decorators TS 5 uses by default. The two
 * dialects call a method decorator with different argument shapes, so we detect which one is
 * calling at runtime and dispatch accordingly. The exported type is an intersection of both
 * decorator shapes so `tsc` accepts it under either `experimentalDecorators` setting.
 */
export function trypatch<
    S extends Schema,
    C = unknown,
> (options: TryPatchOptions<S, C>): LegacyMethodDecorator & Stage3MethodDecorator<S> {
    const logger = new Logger(options.logging)

    return ((...args: unknown[]): unknown => {
        const [first, second, third] = args

        if (args.length === 3 && (typeof second === 'string' || typeof second === 'symbol')) {
            return applyLegacyDecorator(options, logger, first as object, second, third as PropertyDescriptor)
        }

        if (args.length === 2 && isStage3MethodContext(second)) {
            return applyStage3Decorator(options, logger, first as AnyMethod, second)
        }

        throw new TrypatchFatalError('trypatch can only decorate methods')
    }) as LegacyMethodDecorator & Stage3MethodDecorator<S>
}

function isStage3MethodContext (value: unknown): value is AnyMethodContext {
    return typeof value === 'object' && value !== null && 'kind' in value
}

function applyStage3Decorator<S extends Schema, C> (
    options: TryPatchOptions<S, C>,
    logger: Logger,
    originalMethod: AnyMethod,
    context: AnyMethodContext,
): AnyMethod {
    if (context.kind !== 'method') {
        throw new TrypatchFatalError('trypatch can only decorate methods')
    }

    const methodDescriptor = {
        dialect: 'stage3',
        name: context.name,
        static: context.static,
        private: context.private,
        context,
    } as const satisfies MethodDescriptor

    return wrapMethod(originalMethod, options, logger, methodDescriptor)
}

function applyLegacyDecorator<S extends Schema, C> (
    options: TryPatchOptions<S, C>,
    logger: Logger,
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
): PropertyDescriptor {
    const originalMethod = descriptor.value as unknown
    if (typeof originalMethod !== 'function') {
        throw new TrypatchFatalError('trypatch can only decorate methods')
    }

    const methodDescriptor = {
        dialect: 'legacy',
        name: propertyKey,
        static: typeof target === 'function',
        private: false,
        target,
        descriptor,
    } as const satisfies MethodDescriptor

    return {
        ...descriptor,
        value: wrapMethod(originalMethod as AnyMethod, options, logger, methodDescriptor),
    }
}

function wrapMethod<S extends Schema, C> (
    originalMethod: AnyMethod,
    options: TryPatchOptions<S, C>,
    logger: Logger,
    methodDescriptor: MethodDescriptor,
): AnyMethod {
    return function trypatchedMethod (this: unknown, ...args: unknown[]): unknown {
        return Promise.resolve()
            .then(() => originalMethod.apply(this, args))
            .catch((error: unknown) => runInvestigation(
                error,
                options,
                logger,
                methodDescriptor,
                this,
                args,
            ))
    }
}
