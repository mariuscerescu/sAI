/**
 * Generate this package's Typert artifacts (`lib/typert.host.*`,
 * `lib/typert.remote-client.*`). The tsdown plugin's package mode cannot
 * locate the repository root from a package that owns a `tsconfig.host.json`,
 * so this runs the workspace generator for this one package.
 * Run from the repository root: `node --import tsx/esm packages/experimental/sai/scripts/gen-typert.ts`.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../../../typert/generator/src/workspace.ts'

const PACKAGE = '@deepseek-ai/dsh-experimental-sai'
const root = resolve(import.meta.dirname, '../../../..')
const output = join(root, 'packages/experimental/sai/lib')
const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
const artifacts = generator.generate([PACKAGE], ['host'])
mkdirSync(output, { recursive: true })
let remote = false
for (const artifact of artifacts) {
  writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote !== undefined) {
    remote = true
    writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
if (!remote) for (const file of ['typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map']) rmSync(join(output, file), { force: true })
console.log(`typert: ${artifacts.length} artifact(s) for ${PACKAGE}${remote ? ' with Remote client' : ''}`)
