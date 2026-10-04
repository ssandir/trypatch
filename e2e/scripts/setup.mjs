// Packs the already-built root package and installs that tarball, so the e2e test runs against
// exactly what npm consumers get. The tarball path is fixed so package.json doesn't change per version.
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const e2eDir = fileURLToPath(new URL('..', import.meta.url))
const packDir = fileURLToPath(new URL('../.pack', import.meta.url))

rmSync(packDir, { recursive: true, force: true })
mkdirSync(packDir)

const packed = JSON.parse(execFileSync('npm', ['pack', '..', '--pack-destination', packDir, '--json', '--ignore-scripts'], { cwd: e2eDir, encoding: 'utf8' }))
renameSync(`${packDir}/${packed[0].filename}`, `${packDir}/trypatch.tgz`)

// Same path, new contents: npm would keep the copy it already installed, and the lockfile's
// integrity hash would reject the new tarball (hence package-lock=false in .npmrc).
rmSync(`${e2eDir}/node_modules/@ssandir/trypatch`, { recursive: true, force: true })
execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: e2eDir, stdio: 'inherit' })
