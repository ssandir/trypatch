import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readRepoFile (path: string): string {
    return readFileSync(join(__dirname, '..', path), 'utf8')
}

describe('README', () => {
    // GitHub and npm can't include files, so the README carries a copy of the type-checked example.
    it('should show the quick start from examples/quick-start.ts', () => {
        const readmeCode = /^```typescript\n([\s\S]*?)^```$/m.exec(readRepoFile('README.md'))?.[1]
        const exampleCode = /^\/\/ #region quick-start\n([\s\S]*?)^\/\/ #endregion quick-start$/m.exec(readRepoFile('examples/quick-start.ts'))?.[1]

        expect(exampleCode).toBeDefined()
        expect(readmeCode).toBe(exampleCode)
    })
})
