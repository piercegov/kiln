/**
 * bun run build: assembles dist/, the folder `npm publish` ships as kiln-ecs.
 *
 *   dist/lib/        compiled JS + .d.ts (Node can't strip types inside node_modules), with the
 *                    names transform already applied, so Kiln's own systems keep their names
 *   dist/src/        the TypeScript source, for the source and declaration maps (and for agents)
 *   dist/template/, dist/community/, dist/docs/   what kiln new, kiln add and kiln docs copy
 *   dist/package.json   this package.json with exports and bin pointed at lib/
 *
 * The repo itself keeps pointing at src/, so the workspace needs no build to run or test.
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { addNames } from '../src/tooling/names.ts'

const pkgDir = resolve(import.meta.dir, '..')
const dist = join(pkgDir, 'dist')
const repo = resolve(pkgDir, '../..')

rmSync(dist, { recursive: true, force: true })
const tsc = spawnSync('bunx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: pkgDir, stdio: 'inherit' })
if (tsc.status !== 0) process.exit(tsc.status ?? 1)

let named = 0
for (const file of walk(join(dist, 'lib'))) {
  if (!file.endsWith('.js')) continue
  const out = addNames(readFileSync(file, 'utf8'))
  if (out) {
    writeFileSync(file, out)
    named++
  }
}

for (const dir of ['src', 'template', 'community', 'docs']) cpSync(join(pkgDir, dir), join(dist, dir), { recursive: true })
// npm never packs a .gitignore, so the template's travels as _gitignore and kiln new renames it back.
renameSync(join(dist, 'template/.gitignore'), join(dist, 'template/_gitignore'))
// An empty .npmignore stops npm falling back to .gitignore rules: dist/ ships exactly as built.
writeFileSync(join(dist, '.npmignore'), '')
for (const f of ['README.md', 'LICENSE']) if (existsSync(join(repo, f))) cpSync(join(repo, f), join(dist, f))

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
const lib = (src: string) => src.replace(/^\.\/src\//, './lib/').replace(/\.ts$/, '')
pkg.exports = Object.fromEntries(
  Object.entries(pkg.exports as Record<string, string>).map(([k, v]) => [k, { types: `${lib(v)}.d.ts`, default: `${lib(v)}.js` }]),
)
pkg.bin = Object.fromEntries(Object.entries(pkg.bin as Record<string, string>).map(([k, v]) => [k, `${lib(v)}.js`]))
delete pkg.devDependencies
delete pkg.scripts
writeFileSync(join(dist, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

console.log(`ok built ${pkg.name}@${pkg.version} in dist/ (${named} modules named)`)

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}
