// Runs every *.e2e.ts file, or only the ones named on the command line (with or without `.e2e.ts`),
// e.g. `npm test -- claude-retry-after`. Arguments starting with `-` are passed through to `node --test`.
import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { readdirSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const e2eDir = fileURLToPath(new URL('..', import.meta.url))
const available = readdirSync(e2eDir).filter(file => file.endsWith('.e2e.ts')).sort()

const args = process.argv.slice(2)
const flags = args.filter(arg => arg.startsWith('-'))
const names = args.filter(arg => !arg.startsWith('-'))

const files = names.length === 0
    ? available
    : names.map(name => name.endsWith('.e2e.ts') ? name : `${name}.e2e.ts`)

const unknown = files.filter(file => !available.includes(file))
if (unknown.length > 0) {
    console.error(`Unknown e2e test ${unknown.join(', ')}. Available: ${available.map(file => file.replace(/\.e2e\.ts$/, '')).join(', ')}`)
    process.exit(1)
}

const { status } = spawnSync(process.execPath, [
    '--env-file-if-exists=.env',
    '--import', 'tsx',
    '--test',
    '--test-reporter=spec',
    ...flags,
    ...files,
], { cwd: e2eDir, stdio: 'inherit' })

process.exit(status ?? 1)
