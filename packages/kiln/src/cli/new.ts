import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { Args } from './args.ts'
import { KilnError } from '../core/errors.ts'
import { guideText } from './docs.ts'

/**
 * The kiln-ecs version a new game depends on. Installed from the registry (bunx kiln-ecs new), the
 * version that made it; inside the monorepo's examples/, the workspace; from any other checkout, a
 * file: path back to it, so local changes show up in the game.
 */
export function kilnDependency(kilnDir: string, dest: string, version: string): string {
  if (kilnDir.split(sep).includes('node_modules')) return `^${version}`
  const monorepo = resolve(kilnDir, '../..')
  if (dest.startsWith(join(monorepo, 'examples') + sep)) return 'workspace:*'
  return `file:${relative(dest, kilnDir) || '.'}`
}

/** kiln new <dir>: a playable starter game with a scenario test and AGENTS.md. */
export default async function create(args: Args, root: string): Promise<number> {
  const target = args._[0]
  if (!target) throw new KilnError('missing-dir', 'kiln new needs a folder: kiln new my-game')
  const dest = resolve(root, target)
  if (existsSync(dest) && readdirSync(dest).length > 0 && !args.force) {
    throw new KilnError('not-empty', `${target} exists and isn't empty. Pick a new folder or pass --force.`)
  }
  const kilnDir = resolve(new URL('.', import.meta.url).pathname, '../..')
  cpSync(join(kilnDir, 'template'), dest, { recursive: true })
  // The npm package carries the template's .gitignore as _gitignore (npm won't pack a .gitignore).
  if (existsSync(join(dest, '_gitignore'))) renameSync(join(dest, '_gitignore'), join(dest, '.gitignore'))
  const name = basename(dest).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const version = JSON.parse(readFileSync(join(kilnDir, 'package.json'), 'utf8')).version as string
  const dep = kilnDependency(kilnDir, dest, version)
  for (const f of ['package.json', 'index.html']) {
    const p = join(dest, f)
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__NAME__', name).replaceAll('__KILN__', dep))
  }
  writeFileSync(join(dest, 'AGENTS.md'), guideText().trimEnd() + '\n\n<!-- Run `kiln docs` after `bun install` to add this game\'s schedule and exports. -->\n')
  if (args.json) console.log(JSON.stringify({ created: dest }))
  else {
    console.log(`ok created ${relative(process.cwd(), dest) || dest}`)
    console.log(`next: cd ${target} && bun install && bun run docs && bun run test && bun run dev`)
  }
  return 0
}
