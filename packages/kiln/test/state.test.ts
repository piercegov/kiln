import { afterEach, describe, expect, test } from 'bun:test'
import {
  App,
  chain,
  createApp,
  CorePlugins,
  despawnOnExit,
  Fixed,
  inState,
  KilnError,
  Mut,
  not,
  onEnter,
  onExit,
  resource,
  runIf,
  state,
  stateChanged,
  system,
  trait,
  Transform,
  Update,
} from '../src/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk() {
  const a = createApp().use(CorePlugins)
  apps.push(a)
  return a
}

export const Screen = state(['menu', 'playing', 'gameover'], 'menu')
export const Counter = resource({ n: 0 })
const Health = trait({ hp: 1 })

describe('runIf', () => {
  test('skips gated systems while the condition is false', () => {
    const log: string[] = []
    const A = system(() => void log.push('A'))
    const B = system(() => void log.push('B'))
    const Open = resource({ on: false })
    const app = mk().init(Open).add(Fixed, runIf(({ res }) => res.get(Open).on, A), B)
    app.step(2)
    expect(log).toEqual(['B', 'B'])
    app.res(Open).on = true
    app.step(1)
    expect(log).toEqual(['B', 'B', 'A', 'B'])
  })

  test('gated chains keep their order and nest', () => {
    const log: string[] = []
    const A = system(() => void log.push('A'))
    const B = system(() => void log.push('B'))
    const C = system(() => void log.push('C'))
    const yes = () => true
    const app = mk().add(Fixed, runIf(yes, chain(C, runIf(yes, B), A)))
    app.step(1)
    expect(log).toEqual(['C', 'B', 'A'])
    const app2 = mk().add(Fixed, runIf(yes, runIf(not(yes), A)), B)
    log.length = 0
    app2.step(1)
    expect(log).toEqual(['B'])
  })

  test('write-conflict checks still see gated systems', () => {
    const W1 = system([Mut(Health)], () => {})
    const W2 = system([Mut(Health)], () => {})
    expect(() => mk().add(Fixed, runIf(() => true, W1), W2).build()).toThrow(/both take Mut\(Health\)/)
  })

  test('kiln describe shows conditions', () => {
    const Play = system(() => {})
    const app = mk().init(Screen).add(Update, runIf(inState(Screen, 'playing'), Play))
    const d = app.describe()
    const s = d.phases.find((p) => p.name === 'Update')!.systems.find((x) => x.name === 'Play')!
    expect(s.runIf).toEqual(['inState(Screen,playing)'])
  })

  test('replaceSystem keeps the gate', () => {
    const log: string[] = []
    const Old = system(() => void log.push('old'))
    const New = system(() => void log.push('new'))
    const app = mk().add(Fixed, runIf(() => false, Old))
    app.step(1)
    app.replaceSystem(Old, New)
    app.step(1)
    expect(log).toEqual([])
  })
})

describe('state', () => {
  test('transitions apply at the next frame and gate systems', () => {
    const PlayTick = system(({ res }) => void res.mut(Counter).n++)
    const Start = system(({ res }) => res.mut(Screen).set('playing'))
    const app = mk()
      .init(Screen, Counter)
      .add(Fixed, runIf(inState(Screen, 'playing'), PlayTick), runIf(inState(Screen, 'menu'), Start))
    app.step(1)
    expect(app.res(Screen).current).toBe('menu')
    expect(app.res(Screen).next).toBe('playing')
    expect(app.res(Counter).n).toBe(0)
    app.step(3)
    expect(app.res(Screen).current).toBe('playing')
    expect(app.res(Screen).previous).toBe('menu')
    expect(app.res(Counter).n).toBe(3)
  })

  test('onEnter runs once per entry in Fixed and Update, including the initial value', () => {
    const counts = { fixedEnterMenu: 0, updateEnterPlay: 0, exitMenu: 0, changed: 0 }
    const FE = system(() => void counts.fixedEnterMenu++)
    const UE = system(() => void counts.updateEnterPlay++)
    const EX = system(() => void counts.exitMenu++)
    const CH = system(() => void counts.changed++)
    const app = mk()
      .init(Screen)
      .add(Fixed, runIf(onEnter(Screen, 'menu'), FE))
      .add(Update, runIf(onEnter(Screen, 'playing'), UE), runIf(onExit(Screen, 'menu'), EX), runIf(stateChanged(Screen), CH))
    app.step(5)
    expect(counts).toEqual({ fixedEnterMenu: 1, updateEnterPlay: 0, exitMenu: 0, changed: 0 })
    app.res(Screen).set('playing')
    app.step(5)
    expect(counts).toEqual({ fixedEnterMenu: 1, updateEnterPlay: 1, exitMenu: 1, changed: 1 })
    app.res(Screen).set('menu')
    app.step(5)
    expect(counts).toEqual({ fixedEnterMenu: 2, updateEnterPlay: 1, exitMenu: 1, changed: 2 })
  })

  test('onEnter in Fixed fires on the first fixed step even when a frame runs none', () => {
    let n = 0
    const E = system(() => void n++)
    const app = mk().init(Screen).add(Fixed, runIf(onEnter(Screen, 'playing'), E))
    app.step(1)
    app.res(Screen).set('playing')
    app.tick(0.001) // too short for a fixed step
    expect(n).toBe(0)
    app.tick(1 / 30) // two fixed steps
    expect(n).toBe(1)
  })

  test('despawnOnExit entities go when their state is left', () => {
    const app = mk().init(Screen)
    const menuItem = app.spawn(Transform, despawnOnExit(Screen, 'menu'))
    const keep = app.spawn(Transform)
    app.res(Screen).set('playing')
    app.step(1)
    expect(app.world.has(menuItem)).toBe(false)
    expect(app.world.has(keep)).toBe(true)
  })

  test('set() rejects unknown values and the last set wins', () => {
    const app = mk().init(Screen)
    expect(() => app.res(Screen).set('nope' as any)).toThrow(KilnError)
    app.res(Screen).set('gameover')
    app.res(Screen).set('playing')
    app.step(1)
    expect(app.res(Screen).current).toBe('playing')
  })

  test('res.get(State) is read-only in systems', () => {
    const Bad = system(({ res }) => (res.get(Screen) as any).set('playing'))
    const app = mk().init(Screen).add(Fixed, Bad)
    expect(() => app.step(1)).toThrow(/res.mut\(Screen\)/)
  })

  test('snapshots carry and restore the state', () => {
    const app = mk().init(Screen)
    app.res(Screen).set('gameover')
    app.step(1)
    const snap = app.snapshot({ resources: [Screen] })
    expect((snap.resources!.Screen as any).current).toBe('gameover')
    const b = mk().init(Screen)
    b.restore(snap)
    expect(b.res(Screen).current).toBe('gameover')
  })
})
