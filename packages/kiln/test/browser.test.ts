import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { existsSync, rmSync } from 'node:fs'
import { resolveConfig } from 'vite'
import { factoryKinds, kiln, shotPage } from '../src/tooling/vite.ts'
import { shotPlan } from '../src/cli/shot.ts'
import { parseArgs } from '../src/cli/args.ts'
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

  test("the shot page is the game's index.html with its boot script swapped for the shot runner", () => {
    const index = `<!doctype html><html><head><style>.card{color:red}</style><script>window.x=1</script></head>
<body><div id="hud"></div><canvas id="game"></canvas>
<script type="module">
  import { boot } from 'kiln/browser'
  import main from './src/main.ts'
  boot(main)
</script><script type="module" src="/src/extra.ts"></script></body></html>`
    const page = shotPage('src/main.ts', index)
    expect(page).toContain('<style>.card{color:red}</style>')
    expect(page).toContain('<script>window.x=1</script>')
    expect(page).toContain('<div id="hud"></div><canvas id="game"></canvas>')
    expect(page).not.toContain('boot(main)')
    expect(page).not.toContain('extra.ts')
    expect(page).toContain("shot(main, document.querySelector('canvas'))")
    expect(page.indexOf('shot(main')).toBeLessThan(page.indexOf('</body>'))
    expect(shotPage('src/main.ts')).toContain('<canvas id="kiln"></canvas>')
  })

  test('dedupes three and koota, so a linked kiln shares them with the game', async () => {
    const config = await resolveConfig({ configFile: false, logLevel: 'silent', plugins: [kiln()] }, 'serve')
    expect(config.resolve.dedupe).toEqual(expect.arrayContaining(['three', 'koota']))
  })
})

describe('kiln shot', () => {
  const scene = `${import.meta.dir}/fixtures/scene`
  test('--setup, --input and --recording become the page plan, with errors that name the fix', () => {
    const plan = shotPlan(parseArgs(['--setup', 'shots/advance.ts', '--input', '[{"frame":1,"tap":"jump"}]']), scene)
    expect(plan.setup).toBe(`/@fs/${`${scene}/shots/advance.ts`.replace(/^\/+/, '')}`)
    expect(plan.input).toEqual([{ frame: 1, tap: 'jump' }])
    expect(() => shotPlan(parseArgs(['--setup', 'nope.ts']), scene)).toThrow('default export is (app) => void')
    expect(() => shotPlan(parseArgs(['--input', '{"frame":1}']), scene)).toThrow('a JSON array')
    expect(() => shotPlan(parseArgs(['--recording', 'kiln.config.ts']), scene)).toThrow()
    expect(() => shotPlan(parseArgs(['--recording', '{"kiln":"x"}']), scene)).toThrow('not a Kiln recording')
  })

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

  test(
    'runs a setup module and an input script before the steps',
    async () => {
      const out = `${import.meta.dir}/../.shot-setup-test.png`
      rmSync(out, { force: true })
      const input = '[{"frame":1,"tap":"jump"}]'
      const r = await $`bun src/cli/kiln.ts shot --json --steps 30 --setup shots/advance.ts --input ${input} --cwd test/fixtures/scene ${out}`
        .cwd(`${import.meta.dir}/..`)
        .nothrow()
        .quiet()
      const res = JSON.parse(r.stdout.toString().trim().split('\n').pop()!)
      expect(res.errors).toEqual([])
      expect(res.ok).toBe(true)
      expect(res.tick).toBe(35) // 5 from the setup module, 30 from --steps
      rmSync(out, { force: true })
    },
    90_000,
  )
})
