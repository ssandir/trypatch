/**
 * `'low'` logs only each message; `'high'` adds error objects and details such as the AI's explanation.
 * @group Options
 */
export type LoggingVerbosity = 'high' | 'low'

/**
 * A console-like logger, e.g. `console`.
 * @group Options
 */
export type LoggerLike = Pick<Console, 'debug' | 'error' | 'info' | 'log' | 'warn'>

/**
 * Where trypatch logs and how much.
 * @group Options
 */
export type LoggingOptions = {
    /** Nothing is logged without one. */
    logger?: LoggerLike
    /** @defaultValue `'high'` */
    verbosity?: LoggingVerbosity
}

const DEFAULT_VERBOSITY: LoggingVerbosity = 'high'

export class Logger {
    private readonly logger: LoggerLike | undefined
    private readonly verbosity: LoggingVerbosity

    constructor (options: LoggingOptions = {}) {
        this.logger = options.logger
        this.verbosity = options.verbosity ?? DEFAULT_VERBOSITY
    }

    log (...args: unknown[]): void {
        this.write('log', args)
    }

    info (...args: unknown[]): void {
        this.write('info', args)
    }

    warn (...args: unknown[]): void {
        this.write('warn', args)
    }

    error (...args: unknown[]): void {
        this.write('error', args)
    }

    debug (...args: unknown[]): void {
        this.write('debug', args)
    }

    private write (level: keyof LoggerLike, args: unknown[]): void {
        if (!this.logger) {
            return
        }

        const fn = this.logger[level]

        if (typeof fn !== 'function') {
            return
        }

        if (this.verbosity === 'low') {
            fn.call(this.logger, args[0])
            return
        }

        fn.apply(this.logger, args)
    }
}
