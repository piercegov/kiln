import { afterEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { App, chain, createApp, CorePlugins, Fixed, Mut, system, trait, Transform, Update } from '../src/index.ts'

const Velocity = trait({ x: 0, y: 0, z: 0 })
const Health = trait({ hp: 10 })

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk() {
  const a = createApp().use(CorePlugins)
  apps.push(a)
  return a
}

const log: string[] = []
const A = system(() => void log.push('A'))
const B = system(() => void log.push('B'))
const C = system(() => void log.push('C'))
const Movement = system([Mut(Transform), Velocity], () => {})
const PhysicsWriteBack = system([Mut(Transform)], () => {})
const Regen = system([Mut(Health)], () => {})

function order(app: App): string[] {
  log.length = 0
  app.step(1)
  return [...log]
}

describe('ordering', () => {
  test('unconstrained systems keep add() order', () => {
    expect(order(mk().add(Fixed, C, A, B))).toEqual(['C', 'A', 'B'])
  })

  test('chain() orders regardless of add order', () => {
    expect(order(mk().add(Fixed, chain(B, C, A)))).toEqual(['B', 'C', 'A'])
  })

  test('.after() and .before() reorder', () => {
    expect(order(mk().add(Fixed, A.after(C), B.before(C), C))).toEqual(['B', 'C', 'A'])
  })

  test('chains can hold entries and nested chains', () => {
    expect(order(mk().add(Fixed, chain(chain(C, B), A.after(C))))).toEqual(['C', 'B', 'A'])
  })
})

describe('validation errors name the fix', () => {
  test('write conflict', () => {
    const app = mk().add(Fixed, Movement, PhysicsWriteBack)
    expect(() => app.build()).toThrow(
      'Movement and PhysicsWriteBack both take Mut(Transform) in Fixed with no order. Put them in chain() or add .after().',
    )
  })

  test('ordered writers are fine, transitively', () => {
    const app = mk().add(Fixed, chain(Movement, A), PhysicsWriteBack.after(A))
    expect(() => app.build()).not.toThrow()
  })

  test('writers in different phases do not conflict', () => {
    expect(() => mk().add(Fixed, Movement).add(Update, PhysicsWriteBack).build()).not.toThrow()
  })

  test('different traits do not conflict', () => {
    expect(() => mk().add(Fixed, Movement, Regen).build()).not.toThrow()
  })

  test('cycle', () => {
    const app = mk().add(Fixed, chain(A, B, C.before(A)))
    expect(() => app.build()).toThrow('Systems in Fixed form a cycle: A → B → C → A. Remove one chain() link or .after()/.before() to break it.')
  })

  test('unknown after target in another phase', () => {
    const app = mk().add(Update, B).add(Fixed, A.after(B))
    expect(() => app.build()).toThrow("A in Fixed uses .after(B), but B isn't in Fixed, it runs in Update. Add B to Fixed or drop the .after(B).")
  })

  test('unknown after target never added', () => {
    const app = mk().add(Fixed, A.after(C))
    expect(() => app.build()).toThrow("A in Fixed uses .after(C), but C isn't in Fixed (it was never added).")
  })

  test('duplicate', () => {
    expect(() => mk().add(Fixed, A, A)).toThrow('A was added to Fixed twice.')
  })

  test('missing phase', () => {
    expect(() => mk().add(A as any)).toThrow('app.add() needs a phase first: app.add(Fixed, A).')
  })

  test('undefined import', () => {
    expect(() => mk().add(Fixed, undefined as any)).toThrow('got undefined (is the import right?)')
  })
})

describe('hot swap', () => {
  test('replaceSystem keeps the world and re-validates', () => {
    const app = mk().add(Fixed, chain(A, B))
    app.step(1)
    const B2 = system(() => void log.push('B2')).named('B')
    app.replaceSystem(B, B2)
    expect(order(app)).toEqual(['A', 'B2'])
    // A swap that breaks validation is refused and the old schedule stays.
    const Bad = system([Mut(Transform)], () => {}).named('Bad')
    const app2 = mk().add(Fixed, Movement, A)
    expect(() => app2.replaceSystem(A, Bad)).toThrow('Movement and Bad both take Mut(Transform)')
    expect(app2.systemsIn(Fixed).map((s) => s.name)).toEqual(['TickTimers', 'TickTweens', 'Movement', 'A'])
  })
})

describe('describe', () => {
  test('lists phases, access and order', () => {
    const app = mk().add(Fixed, chain(Movement, A))
    const d = app.describe()
    const fixed = d.phases.find((p) => p.name === 'Fixed')!
    expect(fixed.systems.map((s) => s.name)).toEqual(['TickTimers', 'TickTweens', 'Movement', 'A'])
    expect(fixed.systems[2]!.writes).toEqual(['Transform'])
    expect(fixed.systems[2]!.reads).toEqual(['Velocity'])
    expect(fixed.systems[3]!.after).toEqual(['Movement'])
    expect(d.plugins).toEqual(['CorePlugin', 'RenderPlugin', 'InputPlugin', 'AssetsPlugin', 'TimerPlugin', 'TweenPlugin', 'UiPlugin', 'DebugPlugin'])
  })

  test('kiln describe --json on a fixture game', async () => {
    const out = await $`bun src/cli/kiln.ts describe --json --cwd test/fixtures/game`.cwd(`${import.meta.dir}/..`).json()
    const fixed = out.phases.find((p: any) => p.name === 'Fixed')
    expect(fixed.systems.map((s: any) => s.name)).toEqual(['TickTimers', 'TickTweens', 'Movement', 'CollectCoins'])
    expect(out.phases[0].systems[0].resources.writes).toEqual(['Rng'])
    expect(out.traits.map((t: any) => t.name)).toContain('Velocity')
  })

  test('kiln describe reports schedule errors as one parseable line', async () => {
    const r = await $`bun src/cli/kiln.ts describe --json --cwd test/fixtures/bad-game`.cwd(`${import.meta.dir}/..`).nothrow().quiet()
    expect(r.exitCode).toBe(1)
    const out = JSON.parse(r.stdout.toString())
    expect(out.error.code).toBe('write-conflict')
  })
})
