import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

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
        outDir: 'dist',
        sourcemap: true,
        minify: false,
    },
    plugins: [
        dts({
            include: ['src'],
            outDir: 'dist',
            entryRoot: 'src',
        }),
    ],
})
