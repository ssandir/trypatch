const { defaults } = require('jest-config')

module.exports = {
    ...defaults,
    testEnvironment: 'node',
    moduleFileExtensions: [...defaults.moduleFileExtensions, 'ts'],
    transformIgnorePatterns: [
        'node_modules/(?!(flare-redact)/)',
    ],
    transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', {
            jsc: {
                parser: {
                    syntax: 'typescript',
                    decorators: true,
                },
                transform: {
                    decoratorVersion: '2022-03',
                },
            },
        }],
        'node_modules/flare-redact/.+\\.js$': ['@swc/jest', {
            jsc: {
                parser: {
                    syntax: 'ecmascript',
                },
            },
        }],
    },
}
