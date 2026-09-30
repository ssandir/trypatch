const { defaults } = require('jest-config')

// ESM-only dependencies that Jest (CJS) needs compiled.
const esmDependencies = '(flare-redact|ai|@ai-sdk|@standard-schema|eventsource-parser|@workflow|pkce-challenge)'

const esmDependencyTransform = ['@swc/jest', {
    jsc: {
        parser: {
            syntax: 'ecmascript',
        },
    },
}]

const shared = {
    testEnvironment: 'node',
    moduleFileExtensions: [...defaults.moduleFileExtensions, 'ts'],
    transformIgnorePatterns: [
        `node_modules/(?!${esmDependencies}/)`,
    ],
}

module.exports = {
    passWithNoTests: true,
    projects: [
        {
            // Compiles decorators as stage-3 (TC39, TS 5 default) — the dialect trypatch.ts is written against.
            ...shared,
            displayName: 'stage-3',
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
                [`node_modules/${esmDependencies}/.+\\.js$`]: esmDependencyTransform,
            },
        },
        {
            // Compiles decorators as legacy `experimentalDecorators` (NestJS/TypeORM/etc. dialect) to
            // exercise trypatch's runtime dispatch for that call shape. See trypatch.ts for why both
            // dialects are supported.
            ...shared,
            displayName: 'legacy-decorators',
            testMatch: ['**/trypatch.spec.ts'],
            transform: {
                '^.+\\.(t|j)sx?$': ['@swc/jest', {
                    jsc: {
                        parser: {
                            syntax: 'typescript',
                            decorators: true,
                        },
                        transform: {
                            legacyDecorator: true,
                        },
                    },
                }],
                [`node_modules/${esmDependencies}/.+\\.js$`]: esmDependencyTransform,
            },
        },
    ],
}
