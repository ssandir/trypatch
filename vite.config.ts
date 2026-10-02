import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { dependencies, peerDependencies } from './package.json'

// Bundling these would ship duplicate copies of what consumers already install, and
// a bundled zod would not be the instance the consumer's schemas were built with.
const externalPackages = [...Object.keys(dependencies), ...Object.keys(peerDependencies)]

export default defineConfig({
    build: {
        lib: {
            entry: 'src/index.ts',
            name: 'trypatch',
            formats: ['es', 'cjs'],
            fileName: (format) => {
                if (format === 'es') return 'index.js'
                if (format === 'cjs') return 'index.cjs'
                return 'index.js'
            },
        },
        rolldownOptions: {
            external: (id) => id.startsWith('node:')
                || externalPackages.some((name) => id === name || id.startsWith(`${name}/`)),
        },
        outDir: 'dist',
        sourcemap: true,
        minify: false,
    },
    plugins: [
        dts({
            include: ['src'],
            exclude: ['src/**/*.spec.ts', 'src/**/*.testTypes.ts', 'src/test'],
            outDirs: 'dist',
            entryRoot: 'src',
        }),
    ],
})
