import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { existsSync, rmSync } from 'node:fs'
import { factoryKinds } from '../src/tooling/vite.ts'
import { addNames } from '../src/tooling/names.ts'

describe('vite plugin', () => {
  test('factoryKinds tells system-only modules apart', () => {
    expect(factoryKinds('export const A = system(() => {})\nexport const B = system([X], f)')).toEqual(['system', 'system'])
    expect(factoryKinds('export const T = trait({ x: 0 })\nexport const H = event<{ a: 1 }>()')).toEqual(['trait', 'event'])
  })

  test('names transform keeps generics and member calls valid', () => {
    const out = addNames('export const Hit = event<{ a: number }>()\nconst p = kiln.prefab((x) => [])\n')!
    expect(out).toContain('export const Hit = void globalThis.__kiln_n?.("Hit") ?? event<{ a: number }>()')
    expect(out).toContain('globalThis.__kiln_name?.(Hit, "Hit")')
    expect(out).toContain('const p = void globalThis.__kiln_n?.("p") ?? kiln.prefab(')
  })
})

describe('kiln shot', () => {
  test(
    'renders a frame in headless Chromium',
    async () => {
      const out = `${import.meta.dir}/../.shot-test.png`
      rmSync(out, { force: true })
      const r = await $`bun src/cli/kiln.ts shot --json --steps 30 --cwd test/fixtures/scene ${out}`.cwd(`${import.meta.dir}/..`).nothrow().quiet()
      const res = JSON.parse(r.stdout.toString().trim().split('\n').pop()!)
      expect(res.ok).toBe(true)
      expect(res.tick).toBe(30)
      expect(['webgpu', 'webgl2']).toContain(res.backend)
      expect(existsSync(out)).toBe(true)
      expect(Bun.file(out).size).toBeGreaterThan(2000)
      rmSync(out, { force: true })
    },
    90_000,
  )
})
