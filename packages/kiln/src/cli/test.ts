import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Args } from './args.ts'

/** kiln test [bun test args]: runs scenario files with bun test from the game root. */
export default async function test(args: Args, root: string): Promise<number> {
  const passthrough = args._.length ? args._ : existsSync(resolve(root, 'scenarios')) ? ['scenarios'] : []
  const extra: string[] = []
  for (const [k, v] of Object.entries(args)) {
    if (k === '_' || k === 'cwd' || k === 'json') continue
    extra.push(v === true ? `--${k}` : `--${k}=${v}`)
  }
  const r = spawnSync('bun', ['test', ...passthrough, ...extra], { cwd: root, stdio: 'inherit' })
  return r.status ?? 1
}
