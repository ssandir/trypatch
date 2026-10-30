import { TrypatchFatalError } from './errors'
import { validateAiInvestigationOptions } from './investigation/aiInvestigation/options/validateOptions'
import { runInvestigation } from './investigation/runInvestigation'
import { Logger } from './logger'
import type { Schema } from './schema/types'
import type {
    AnyMethod,
    AnyMethodContext,
    LegacyMethodDecorator,
    MethodDescriptor,
    Stage3MethodDecorator,
    TrypatchOptions,
} from './types'

/**
 * Method decorator that investigates a failed call (with an AI provider or your own handler) and returns the
 * value it recovers in place of the error, or rejects with the original error when nothing is recovered.
 * The decorated method must return a `Promise`; TC39 stage-3 and legacy `experimentalDecorators` both work.
 * @group Decorator
 */
export function trypatch<
    ResultSchema extends Schema,
    ToolContext = unknown,
> (options: TrypatchOptions<ResultSchema, ToolContext>): LegacyMethodDecorator & Stage3MethodDecorator<ResultSchema> {
    const logger = new Logger(options.logging)
    if ('aiInvestigation' in options) {
        validateAiInvestigationOptions(options.aiInvestigation)
    }

    // The two dialects call a decorator with different argument shapes, so we detect the caller's at runtime.
    // The return type intersects both shapes so `tsc` accepts it under either `experimentalDecorators` setting.
    return ((...args: unknown[]): unknown => {
        const [first, second, third] = args

        if (args.length === 3 && (typeof second === 'string' || typeof second === 'symbol')) {
            return applyLegacyDecorator(options, logger, first as object, second, third as PropertyDescriptor)
        }

        if (args.length === 2 && isStage3MethodContext(second)) {
            return applyStage3Decorator(options, logger, first as AnyMethod, second)
        }

        throw new TrypatchFatalError('trypatch can only decorate methods')
    }) as LegacyMethodDecorator & Stage3MethodDecorator<ResultSchema>
}

function isStage3MethodContext (value: unknown): value is AnyMethodContext {
    return typeof value === 'object' && value !== null && 'kind' in value
}

function applyStage3Decorator<S extends Schema, C> (
    options: TrypatchOptions<S, C>,
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
        method: originalMethod,
        static: context.static,
        private: context.private,
        context,
    } as const satisfies MethodDescriptor

    return wrapMethod(originalMethod, options, logger, methodDescriptor)
}

function applyLegacyDecorator<S extends Schema, C> (
    options: TrypatchOptions<S, C>,
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
        method: originalMethod as AnyMethod,
        static: typeof target === 'function',
        private: false,
        target,
        descriptor,
    } as const satisfies MethodDescriptor

    return {
        ...descriptor,
        value: wrapMethod(methodDescriptor.method, options, logger, methodDescriptor),
    }
}

function wrapMethod<S extends Schema, C> (
    originalMethod: AnyMethod,
    options: TrypatchOptions<S, C>,
    logger: Logger,
    methodDescriptor: MethodDescriptor,
): AnyMethod {
    // An async function rather than a promise chain, so the method body runs at call time like an undecorated method.
    return async function trypatchedMethod (this: unknown, ...args: unknown[]): Promise<unknown> {
        const startedAt = new Date()
        // Monotonic, unlike Date, so a clock adjustment mid-call can't skew the duration.
        const start = performance.now()

        try {
            return await originalMethod.apply(this, args)
        } catch (error) {
            return await runInvestigation(
                error,
                options,
                logger,
                methodDescriptor,
                this,
                args,
                { startedAt, durationMs: Math.round(performance.now() - start) },
            )
        }
    }
}
