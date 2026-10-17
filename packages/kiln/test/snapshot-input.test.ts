import { afterEach, describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import {
  App,
  ChildOf,
  createApp,
  CorePlugins,
  Fixed,
  Mut,
  resource,
  Rng,
  Startup,
  system,
  trait,
  Transform,
  Update,
} from '../src/index.ts'
import { Input } from '../src/plugins/input/index.ts'
import { checkDeterminism } from '../src/cli/check.ts'

const Health = trait({ hp: 10 })
const Velocity = trait({ x: 0, y: 0, z: 0 })
const IsEnemy = trait()
const Score = resource({ value: 0 })

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(config = {}) {
  const a = createApp({ seed: 3, ...config }).use(CorePlugins)
  apps.push(a)
  return a
}

const Wander = system([Mut(Transform), IsEnemy], ([t], { res }) => {
  const rng = res.mut(Rng)
  t.x += rng.float(-1, 1)
  t.z += rng.float(-1, 1)
})
const SpawnEnemies = system(({ commands }) => {
  for (let i = 0; i < 4; i++) commands.spawn(Transform({ x: i }), Health, IsEnemy)
})

describe('snapshots', () => {
  test('captures requested traits and resources as JSON', () => {
    const app = mk().init(Score)
    const e = app.spawn(Transform({ x: 1 }), Health({ hp: 3 }), IsEnemy)
    app.spawn(Velocity) // has neither Health nor IsEnemy
    app.res(Score).value = 7
    const s = app.snapshot({ traits: [Health, IsEnemy], resources: [Score] })
    expect(s.entities).toEqual([{ id: e.id(), gen: e.generation(), traits: { Health: { hp: 3 }, IsEnemy: true } }])
    expect(s.resources).toEqual({ Score: { value: 7 } })
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  test('diff shows added, removed and changed fields', () => {
    const app = mk()
    const a = app.spawn(Health({ hp: 10 }))
    const b = app.spawn(Health({ hp: 5 }))
    const before = app.snapshot({ traits: [Health] })
    app.set(a, Health, { hp: 4 })
    app.despawn(b)
    const c = app.spawn(Health({ hp: 1 }))
    const d = app.diff(before, app.snapshot({ traits: [Health] }))
    expect(d.changed).toEqual([{ id: a.id(), trait: 'Health', field: 'hp', from: 10, to: 4 }])
    expect(d.removed).toEqual([b.id()])
    expect(d.added.map((x) => x.id)).toEqual([c.id()])
    expect(d.same).toBe(false)
  })

  test('relations serialize as target ids and restore with remapped ids', () => {
    const app = mk()
    const parent = app.spawn(Transform({ y: 2 }))
    app.spawn(Transform, ChildOf(parent))
    const snap = app.snapshot()
    const child = snap.entities.find((x) => 'ChildOf' in x.traits)!
    expect(child.traits.ChildOf).toEqual([parent.id()])

    const other = mk()
    other.spawn(Health) // shift ids so the remap matters
    const { missingTraits } = other.restore(snap)
    expect(missingTraits).toEqual([])
    const [p] = other.query(Transform).filter((e) => other.get(e, Transform)!.y === 2)
    const kids = other.query(ChildOf(p!))
    expect(kids.length).toBe(1)
    expect(other.query(Health).length).toBe(0)
  })

  test('same seed, same steps, same world', () => {
    const run = (seed: number) => {
      const app = mk({ seed }).add(Startup, SpawnEnemies).add(Fixed, Wander)
      app.step(300)
      return app.snapshot({ traits: [Transform], resources: [Rng] })
    }
    const a = run(11)
    const b = run(11)
    expect(a).toEqual(b)
    expect(mk().diff(a, run(12)).same).toBe(false)
  })

  test('restore round-trips into a fresh app, including Rng state', () => {
    const a = mk({ seed: 5 }).add(Startup, SpawnEnemies).add(Fixed, Wander)
    a.step(30)
    const snap = a.snapshot({ resources: true })
    const b = mk({ seed: 999 }).add(Fixed, Wander)
    b.boot()
    b.restore(snap)
    a.step(30)
    b.step(30)
    const sa = a.snapshot({ traits: [Transform] })
    const sb = b.snapshot({ traits: [Transform] })
    expect(sa.entities.map((e) => e.traits)).toEqual(sb.entities.map((e) => e.traits))
  })
})

describe('scripted input', () => {
  test('pressed() fires for exactly one fixed step; down() holds', () => {
    const jumps: number[] = []
    const held: number[] = []
    const Jump = system(({ res, time }) => {
      const input = res.get(Input)
      if (input.pressed('jump')) jumps.push(time.tick)
      if (input.down('jump')) held.push(time.tick)
    })
    const app = mk().add(Fixed, Jump)
    app.input.script([
      { frame: 3, press: 'jump' },
      { frame: 6, release: 'jump' },
      { frame: 10, tap: 'jump' },
    ])
    app.step(12)
    expect(jumps).toEqual([2, 9])
    expect(held).toEqual([2, 3, 4, 9])
  })

  test('presses on frames with no fixed step are kept for the next step', () => {
    const jumps: number[] = []
    const Jump = system(({ res, time }) => {
      if (res.get(Input).pressed('jump')) jumps.push(time.tick)
    })
    const app = mk().add(Fixed, Jump)
    app.input.tap('jump')
    app.tick(0.005) // no fixed step this frame; tap releases next frame
    app.tick(0.005)
    app.tick(0.01) // first fixed step
    app.tick(0.02)
    expect(jumps).toEqual([0])
  })

  test('Update readers get frame edges, many fixed steps see one press', () => {
    let fixedPresses = 0
    let updatePresses = 0
    const app = mk({ maxFixedSteps: 5 })
      .add(Fixed, system(({ res }) => void (res.get(Input).pressed('fire') && fixedPresses++)).named('F'))
      .add(Update, system(({ res }) => void (res.get(Input).pressed('fire') && updatePresses++)).named('U'))
    app.input.press('fire')
    app.tick(0.08) // ~4 fixed steps
    app.tick(0.08)
    expect(fixedPresses).toBe(1)
    expect(updatePresses).toBe(1)
  })

  test('axis comes from the action map or a scripted override', () => {
    const seen: string[] = []
    const Read = system(({ res }) => {
      const { axis } = res.get(Input)
      seen.push(`${axis.x.toFixed(2)},${axis.y.toFixed(2)}`)
    })
    const app = mk().add(Fixed, Read)
    app.input.script([
      { frame: 1, press: 'right' },
      { frame: 2, press: 'up' },
      { frame: 3, axis: { x: 0, y: -0.5 } },
      { frame: 4, axis: null },
      { frame: 4, key: 'KeyA' },
    ])
    app.step(4)
    expect(seen).toEqual(['1.00,0.00', '0.71,0.71', '0.00,-0.50', '0.00,1.00'])
  })

  test('keys go through the action map', () => {
    let jumped = false
    const app = mk().add(Fixed, system(({ res }) => void (jumped ||= res.get(Input).down('jump'))).named('J'))
    app.input.script([{ frame: 1, key: 'Space' }])
    app.step(1)
    expect(jumped).toBe(true)
  })
})

describe('cli', () => {
  const root = `${import.meta.dir}/..`

  test('kiln run prints a snapshot after N steps', async () => {
    const out = await $`bun src/cli/kiln.ts run --steps 120 --snapshot IsPlayer,Transform --resources Score --cwd test/fixtures/game`
      .cwd(root)
      .json()
    expect(out.tick).toBe(120)
    expect(out.entities[0].traits.Transform).toEqual({ x: 2 })
    expect(out.resources.Score.value).toBe(2)
  })

  test('kiln run is deterministic for a seed', async () => {
    const a = await $`bun src/cli/kiln.ts run --steps 60 --seed 4 --cwd test/fixtures/game`.cwd(root).text()
    const b = await $`bun src/cli/kiln.ts run --steps 60 --seed 4 --cwd test/fixtures/game`.cwd(root).text()
    const c = await $`bun src/cli/kiln.ts run --steps 60 --seed 5 --cwd test/fixtures/game`.cwd(root).text()
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  test('kiln run names unknown traits', async () => {
    const r = await $`bun src/cli/kiln.ts run --snapshot Nope --json --cwd test/fixtures/game`.cwd(root).nothrow().quiet()
    expect(JSON.parse(r.stdout.toString()).error.message).toContain('No trait named "Nope". Run `kiln describe`')
  })

  test('kiln check flags Math.random and Date.now', () => {
    const findings = checkDeterminism(`${root}/test/fixtures/nondeterministic`)
    expect(findings.map((f) => `${f.line}:${f.rule}`)).toEqual(['3:no-math-random', '4:no-date-now'])
  })
})
