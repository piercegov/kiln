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

  test('names transform wraps the whole call, at any depth', () => {
    const src = [
      'export const Hit = event<{ a: number }>()',
      'function f() {',
      '  const Movement = system([Mut(Transform), trait()], ([t]) => { t.x += ")" + `${1}` }).named("M2")',
      '}',
      'const R = /\\)/.test("x") ? 1 : 2',
    ].join('\n')
    const out = addNames(src)!
    const N = '(globalThis.__kiln_named ?? ((_n, v) => v))'
    expect(out).toContain(`export const Hit = ${N}("Hit", event<{ a: number }>())`)
    expect(out).toContain(`const Movement = ${N}("Movement", system([Mut(Transform), trait()], ([t]) => { t.x += ")" + \`\${1}\` })).named("M2")`)
    expect(out).toContain('const R = /\\)/.test')
    expect(() => new Function(out.replace(/export /g, '').replace(/<\{ a: number \}>/, ''))).not.toThrow()
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
