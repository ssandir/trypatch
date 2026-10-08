import { buildInvestigationContext } from './investigationContext'
import { mockMethodDescriptor } from '../test/mockMethodDecoratorContext'
import type { MethodDescriptor } from '../types'

describe('buildInvestigationContext', () => {
    it('should carry the error, method name, and args through unchanged', () => {
        const error = new Error('boom')
        const ctx = buildInvestigationContext(error, mockMethodDescriptor('charge'), undefined, ['card-1'])

        expect(ctx.error).toBe(error)
        expect(ctx.methodName).toBe('charge')
        expect(ctx.args).toEqual(['card-1'])
    })

    it('should carry the method source from the method descriptor', () => {
        const descriptor: MethodDescriptor = {
            ...mockMethodDescriptor('charge'),
            method: function charge (cardId: unknown) { return cardId },
        }

        const ctx = buildInvestigationContext(new Error('x'), descriptor, undefined, [])

        expect(ctx.methodSource).toBe(descriptor.method.toString())
    })

    it('should carry static and private from the method descriptor', () => {
        const descriptor: MethodDescriptor = {
            dialect: 'legacy',
            name: 'run',
            method: () => undefined,
            static: true,
            private: false,
            target: () => undefined,
            descriptor: {},
        }

        const ctx = buildInvestigationContext(new Error('x'), descriptor, undefined, [])

        expect(ctx.methodMetadata.static).toBe(true)
        expect(ctx.methodMetadata.private).toBe(false)
    })

    it('should resolve className from an instance receiver', () => {
        class BillingService {}

        const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor('run'), new BillingService(), [])

        expect(ctx.methodMetadata.className).toBe('BillingService')
    })

    it('should resolve className from a class (function) receiver for static methods', () => {
        class BillingService {
            static run (): void {}
        }

        const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor('run'), BillingService, [])

        expect(ctx.methodMetadata.className).toBe('BillingService')
    })

    it('should omit className for a plain object receiver', () => {
        const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor('run'), {}, [])

        expect(ctx.methodMetadata.className).toBeUndefined()
    })

    it('should omit className when there is no receiver', () => {
        const ctx = buildInvestigationContext(new Error('x'), mockMethodDescriptor('run'), undefined, [])

        expect(ctx.methodMetadata.className).toBeUndefined()
    })
})
