import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDocs, renderGameSection, START, END } from '../src/cli/docs.ts'
import { listPlugins } from '../src/cli/add.ts'

const pkg = `${import.meta.dir}/..`
const example = `${import.meta.dir}/../../../examples/coin-collector`

describe('kiln docs', () => {
  test('collects JSDoc for exports, by file', () => {
    const docs = collectDocs(example)
    const movement = docs.find((d) => d.name === 'Movement')!
    expect(movement).toEqual({ name: 'Movement', kind: 'system', doc: 'Integrates Velocity into Transform.', file: 'src/systems/movement.ts' })
    expect(docs.find((d) => d.name === 'Velocity')!.kind).toBe('trait')
    expect(docs.find((d) => d.name === 'Coin')!.kind).toBe('prefab')
  })

  test('the generated section lists the schedule with files', () => {
    const d = {
      config: { mode: '3d', fixedHz: 60, seed: 1, hotReload: 'keep' },
      plugins: ['CorePlugin'],
      phases: [{ name: 'Fixed', systems: [{ name: 'Movement', form: 'each' as const, reads: ['Velocity'], writes: ['Transform'], after: [], resources: { reads: [], writes: [] } }] }],
      traits: [{ name: 'Velocity', storage: 'soa' as const, fields: { x: 0, y: 0, z: 0 } }],
      resources: [],
      events: [],
    }
    const out = renderGameSection(d, collectDocs(example), example)
    expect(out.startsWith(START)).toBe(true)
    expect(out.trimEnd().endsWith(END)).toBe(true)
    expect(out).toContain('| 1 | Movement | Transform | Velocity | – | – | src/systems/movement.ts |')
    expect(out).toContain('- **Velocity** (`src/traits/velocity.ts`) `{ x: 0, y: 0, z: 0 }`: Linear velocity')
  })

  test("the example's AGENTS.md is up to date", async () => {
    const r = await $`bun ${pkg}/src/cli/kiln.ts docs --check --cwd ${example}`.nothrow().quiet()
    expect(r.stdout.toString().trim()).toBe('ok AGENTS.md is up to date')
  })
})

describe('kiln new', () => {
  test('creates a game from the template', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiln-new-'))
    const dest = join(dir, 'My Game')
    try {
      await $`bun ${pkg}/src/cli/kiln.ts new ${dest}`.quiet()
      const p = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
      expect(p.name).toBe('my-game')
      expect(p.dependencies.kiln.startsWith('file:')).toBe(true)
      for (const f of ['src/main.ts', 'kiln.config.ts', 'scenarios/player.test.ts', 'AGENTS.md', 'index.html']) expect(existsSync(join(dest, f))).toBe(true)
      const again = await $`bun ${pkg}/src/cli/kiln.ts new ${dest} --json`.nothrow().quiet()
      expect(JSON.parse(again.stdout.toString()).error.code).toBe('not-empty')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('kiln add', () => {
  test('lists and copies community plugins', async () => {
    const plugins = listPlugins()
    expect(plugins.map((p) => p.name)).toEqual(expect.arrayContaining(['audio', 'orbit-camera', 'particles', 'terrain', 'water']))
    const dir = mkdtempSync(join(tmpdir(), 'kiln-add-'))
    try {
      const r = await $`bun ${pkg}/src/cli/kiln.ts add water orbit-camera --json --cwd ${dir}`.json()
      expect(r.added.map((a: any) => a.dest)).toEqual(['src/plugins/water', 'src/plugins/orbit-camera'])
      expect(existsSync(join(dir, 'src/plugins/water/index.ts'))).toBe(true)
      expect(existsSync(join(dir, 'src/plugins/water/README.md'))).toBe(true)
      const dup = await $`bun ${pkg}/src/cli/kiln.ts add water --json --cwd ${dir}`.nothrow().quiet()
      expect(JSON.parse(dup.stdout.toString()).error.code).toBe('plugin-exists')
      const bad = await $`bun ${pkg}/src/cli/kiln.ts add nope --json --cwd ${dir}`.nothrow().quiet()
      expect(JSON.parse(bad.stdout.toString()).error.message).toContain('Available:')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
