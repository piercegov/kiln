import { afterEach, describe, expect, test } from 'bun:test'
import {
  App,
  ChildOf,
  createApp,
  CorePlugins,
  Loaded,
  memoryStorage,
  relation,
  resource,
  Saved,
  savePlugin,
  Saves,
  system,
  trait,
  Transform,
  Update,
  type SaveOptions,
} from '../src/index.ts'

export const Level = resource({ n: 1, name: 'start' })
export const Settings = resource({ volume: 1, invertY: false })
export const IsHero = trait()
export const Health = trait({ hp: 3 })
export const Carries = relation()

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(options: SaveOptions) {
  const a = createApp().use(CorePlugins, savePlugin(options))
  apps.push(a)
  return a
}

describe('save slots', () => {
  test('save, change, load: resources and saved entities come back; others stay', () => {
    const app = mk({ resources: [Level], traits: [IsHero, Health, Transform], storage: memoryStorage() })
    const hero = app.spawn(IsHero, Health({ hp: 2 }), Transform({ x: 4 }))
    const scenery = app.spawn(Transform({ x: 99 }), ChildOf(hero))
    app.res(Level).n = 3
    app.res(Saves).save('a')
    app.res(Level).n = 9
    app.set(hero, Health, { hp: 0 })
    app.spawn(IsHero, Health({ hp: 1 }))
    expect(app.res(Saves).load('a')).toBe(true)
    app.step(1)
    expect(app.events(Loaded)).toEqual([{ slot: 'a' }])
    expect(app.res(Level).n).toBe(3)
    const heroes = app.query(IsHero)
    expect(heroes).toHaveLength(1)
    expect(app.get(heroes[0]!, Health)!.hp).toBe(2)
    expect(app.get(heroes[0]!, Transform)!.x).toBe(4)
    // Scenery had a saved trait (Transform), so it was saved and replaced too, but without ChildOf (not listed).
    expect(app.world.has(scenery)).toBe(false)
  })

  test('saving from a system emits Saved; has/slots/delete', () => {
    const storage = memoryStorage()
    const Save = system(({ res, time }) => {
      if (time.frame === 2) res.mut(Saves).save('quick')
    })
    const app = mk({ resources: [Level], storage }).add(Update, Save)
    app.step(2)
    expect(app.events(Saved)).toEqual([{ slot: 'quick' }])
    const s = app.res(Saves)
    expect(s.has('quick')).toBe(true)
    expect(s.slots()).toEqual(['quick'])
    expect(s.load('nope')).toBe(false)
    s.delete('quick')
    expect(s.slots()).toEqual([])
  })

  test('relations between saved entities are relinked', () => {
    const app = mk({ traits: [IsHero, Health, Carries], storage: memoryStorage() })
    const item = app.spawn(Health({ hp: 7 }))
    app.spawn(IsHero, Carries(item))
    app.res(Saves).save()
    app.res(Saves).load()
    app.step(1)
    const hero = app.query(IsHero)[0]!
    const carried = hero.targetsFor(Carries)
    expect(carried).toHaveLength(1)
    expect(app.get(carried[0]!, Health)!.hp).toBe(7)
  })

  test('Saves without the plugin names the fix', () => {
    const app = createApp().use(CorePlugins)
    apps.push(app)
    expect(() => app.res(Saves)).toThrow(/savePlugin/)
  })
})

describe('persisted resources', () => {
  test('survive a restart through shared storage', () => {
    const storage = memoryStorage()
    const a = mk({ persist: [Settings], storage })
    a.res(Settings).volume = 0.3
    a.step(1)
    a.dispose()
    const b = mk({ persist: [Settings], storage })
    expect(b.res(Settings).volume).toBe(0.3)
    expect(b.res(Settings).invertY).toBe(false)
  })

  test('written only when they change', () => {
    const storage = memoryStorage()
    let writes = 0
    const counting = { ...storage, set: (k: string, v: string) => (writes++, storage.set(k, v)) }
    const app = mk({ persist: [Settings], storage: counting })
    app.step(10)
    expect(writes).toBe(0)
    app.res(Settings).invertY = true
    app.step(10)
    expect(writes).toBe(1)
  })
})
