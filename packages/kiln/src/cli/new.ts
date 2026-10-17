import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { Args } from './args.ts'
import { KilnError } from '../core/errors.ts'
import { guideText } from './docs.ts'

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
  const name = basename(dest).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  // Inside the Kiln monorepo, use the workspace; elsewhere point at this checkout.
  const monorepo = resolve(kilnDir, '../..')
  const inWorkspace = dest.startsWith(join(monorepo, 'examples') + '/')
  const dep = inWorkspace ? 'workspace:*' : `file:${relative(dest, kilnDir) || '.'}`
  for (const f of ['package.json', 'index.html']) {
    const p = join(dest, f)
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__NAME__', name).replaceAll('__KILN__', dep))
  }
  writeFileSync(join(dest, 'AGENTS.md'), guideText().trimEnd() + '\n\n<!-- Run `kiln docs` after `bun install` to add this game\'s schedule and exports. -->\n')
  if (args.json) console.log(JSON.stringify({ created: dest }))
  else {
    console.log(`ok created ${relative(process.cwd(), dest) || dest}`)
    console.log(`next: cd ${target} && bun install && kiln docs && kiln test && bunx vite`)
  }
  return 0
}
