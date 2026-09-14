import type { LoggerLike } from './logger'
import { Logger } from './logger'

function createMockLogger (overrides: Partial<LoggerLike> = {}): LoggerLike {
    return {
        log: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        ...overrides,
    }
}

describe('Logger', () => {
    it('should default to high verbosity and log all arguments', () => {
        const loggerLike = createMockLogger()
        const logger = new Logger({ logger: loggerLike })

        logger.info('message', { detail: true }, 42)

        expect(loggerLike.info).toHaveBeenCalledWith('message', { detail: true }, 42)
    })

    it('should log only the first argument in low verbosity mode', () => {
        const loggerLike = createMockLogger()
        const logger = new Logger({
            logger: loggerLike,
            verbosity: 'low',
        })

        logger.error('message', { detail: true }, 42)

        expect(loggerLike.error).toHaveBeenCalledWith('message')
        expect(loggerLike.error).toHaveBeenCalledTimes(1)
    })

    it('should stay silent when no logger is provided', () => {
        const logger = new Logger()

        expect(() => {
            logger.log('log')
            logger.info('info')
            logger.warn('warn')
            logger.error('error')
            logger.debug('debug')
        }).not.toThrow()
    })

    it('should expose standard logger methods', () => {
        const loggerLike = createMockLogger()
        const logger = new Logger({ logger: loggerLike })

        logger.log('log')
        logger.info('info')
        logger.warn('warn')
        logger.error('error')
        logger.debug('debug')

        expect(loggerLike.log).toHaveBeenCalledWith('log')
        expect(loggerLike.info).toHaveBeenCalledWith('info')
        expect(loggerLike.warn).toHaveBeenCalledWith('warn')
        expect(loggerLike.error).toHaveBeenCalledWith('error')
        expect(loggerLike.debug).toHaveBeenCalledWith('debug')
    })
})
