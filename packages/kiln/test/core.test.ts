import { afterEach, describe, expect, test } from 'bun:test'
import {
  App,
  Changed,
  chain,
  createApp,
  CorePlugins,
  event,
  Fixed,
  KilnError,
  Late,
  Mut,
  Not,
  plugin,
  prefab,
  resource,
  Rng,
  Startup,
  system,
  trait,
  Transform,
  Update,
  type Entity,
} from '../src/index.ts'

const Velocity = trait({ x: 0, y: 0, z: 0 })
const Health = trait({ hp: 10 })
const IsPlayer = trait()
const IsCoin = trait()
const Score = resource({ value: 0 })
const Hit = event<{ target: Entity; amount: number }>()

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(config = {}) {
  const a = createApp({ seed: 7, ...config }).use(CorePlugins)
  apps.push(a)
  return a
}

describe('system forms', () => {
  test('no-query system runs once per phase run', () => {
    let runs = 0
    const Count = system(() => void runs++)
    mk().add(Fixed, Count).step(5)
    expect(runs).toBe(5)
  })

  test('per-entity rows skip tags and expose ctx.entity', () => {
    const seen: Entity[] = []
    const Heal = system([Mut(Health), IsPlayer], ([h], { entity }) => {
      h.hp += 1
      seen.push(entity)
    })
    const app = mk().add(Fixed, Heal)
    const p = app.spawn(Health, IsPlayer)
    app.spawn(Health) // not a player
    app.step(3)
    expect(app.get(p, Health)!.hp).toBe(13)
    expect(seen).toEqual([p, p, p])
  })

  test('named queries give first/forEach/each', () => {
    const Collect = system(
      { coins: [Transform, IsCoin], player: [Transform, IsPlayer] },
      ({ coins, player }, { res, commands }) => {
        const p = player.first()
        if (p === undefined) return
        coins.forEach((c) => {
          commands.despawn(c)
          res.mut(Score).value += 1
        })
      },
    )
    const app = mk().add(Fixed, Collect)
    app.spawn(Transform, IsPlayer)
    for (let i = 0; i < 3; i++) app.spawn(Transform, IsCoin)
    app.step(1)
    expect(app.res(Score).value).toBe(3)
    expect(app.query(IsCoin).length).toBe(0)
  })

  test('named query each() honours Mut', () => {
    const Push = system({ movers: [Mut(Transform), Velocity] }, ({ movers }) => {
      movers.each(([t, v]) => {
        t.x += v.x
      })
    })
    const app = mk().add(Fixed, Push)
    const e = app.spawn(Transform, Velocity({ x: 2 }))
    app.step(2)
    expect(app.get(e, Transform)!.x).toBe(4)
  })

  test('Not filters pass straight through', () => {
    let n = 0
    const S = system([Transform, Not(IsPlayer)], () => void n++)
    const app = mk().add(Fixed, S)
    app.spawn(Transform, IsPlayer)
    app.spawn(Transform)
    app.step(1)
    expect(n).toBe(1)
  })

  test('rows can be spread like plain records', () => {
    let copy: any
    const S = system([Transform], ([t]) => {
      copy = { ...t }
    })
    const app = mk().add(Fixed, S)
    app.spawn(Transform({ x: 3 }))
    app.step(1)
    expect(copy).toEqual({ x: 3, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 })
  })
})

describe('commands', () => {
  test('apply at the phase boundary, not mid-phase', () => {
    const counts: number[] = []
    const Spawner = system(({ commands }) => {
      commands.spawn(Health)
    })
    const Counter = system({ all: [Health] }, ({ all }) => {
      counts.push(all.length)
    })
    mk().add(Fixed, chain(Spawner, Counter)).step(3)
    // Counter runs after Spawner in the same phase but sees the spawn only next step.
    expect(counts).toEqual([0, 1, 2])
  })

  test('prefabs spawn named recipes and double despawn is a no-op', () => {
    const Enemy = prefab((p: { hp: number }) => [Transform, Health({ hp: p.hp })])
    const Spawn = system(({ commands }) => {
      const pe = commands.spawn(Enemy, { hp: 30 })
      commands.despawn(pe)
      commands.despawn(pe)
    })
    const app = mk().add(Startup, Spawn)
    app.step(1)
    expect(app.query(Health).length).toBe(0)
    const e = app.spawn(Enemy, { hp: 5 })
    expect(app.get(e, Health)!.hp).toBe(5)
  })

  test('add and remove are deferred', () => {
    const Tagger = system([Health, Not(IsPlayer)], (_, { commands, entity }) => {
      commands.add(entity, IsPlayer)
    })
    const app = mk().add(Fixed, Tagger)
    const e = app.spawn(Health)
    app.step(1)
    expect(app.has(e, IsPlayer)).toBe(true)
  })
})

describe('events', () => {
  const Emit = system(({ events, time }) => {
    events.emit(Hit, { target: 0 as Entity, amount: time.tick })
  })

  test('each reader sees each event exactly once, and tests read them per step()', () => {
    const got: number[] = []
    const Read = system(({ events }) => {
      for (const h of events.read(Hit)) got.push(h.amount)
    })
    const app = mk().add(Fixed, chain(Emit, Read))
    app.step(3)
    expect(got).toEqual([0, 1, 2])
    expect(app.events(Hit).map((h) => h.amount)).toEqual([0, 1, 2])
    app.step(1)
    expect(app.events(Hit).map((h) => h.amount)).toEqual([3])
  })

  test('reader that runs before the emitter sees last step’s events', () => {
    const got: number[] = []
    const Read = system(({ events }) => {
      for (const h of events.read(Hit)) got.push(h.amount)
    })
    mk().add(Fixed, chain(Read, Emit)).step(3)
    expect(got).toEqual([0, 1])
  })

  test('Update readers see every Fixed event even with many fixed steps per frame', () => {
    const got: number[] = []
    const Read = system(({ events }) => {
      for (const h of events.read(Hit)) got.push(h.amount)
    })
    const app = mk({ maxFixedSteps: 10 }).add(Fixed, Emit).add(Update, Read)
    app.tick(0.25 + 1e-9) // up to 10 fixed steps in one frame (15 at 60Hz, capped)
    app.tick(1 / 60 + 1e-9)
    const ticks = app.time.tick
    expect(got).toEqual([...Array(ticks).keys()])
  })

  test('events expire after two runs of the emitting phase', () => {
    const app = mk().add(Fixed, Emit)
    app.step(5)
    // A reader added later only sees what is still buffered: the last two runs.
    const got: number[] = []
    app.add(
      Fixed,
      system(({ events }) => {
        for (const h of events.read(Hit)) got.push(h.amount)
      }).named('LateReader').after(Emit),
    )
    app.step(1)
    expect(got).toEqual([4, 5])
  })
})

describe('resources', () => {
  test('res.get is read-only in dev and names the fix', () => {
    const Cheat = system(({ res }) => {
      ;(res.get(Score) as any).value = 99
    }).named('Cheat')
    const app = mk().add(Fixed, Cheat)
    expect(() => app.step(1)).toThrow('Cheat wrote Score.value through res.get(Score), which is read-only. Use res.mut(Score).')
  })

  test('Rng is seeded and deterministic', () => {
    const rolls = (seed: number) => {
      const out: number[] = []
      const Roll = system(({ res }) => void out.push(res.mut(Rng).int(0, 1000)))
      mk({ seed }).add(Fixed, Roll).step(10)
      return out
    }
    expect(rolls(1)).toEqual(rolls(1))
    expect(rolls(1)).not.toEqual(rolls(2))
  })

  test('reading Rng through res.get is caught', () => {
    const Bad = system(({ res }) => void (res.get(Rng) as any).float())
    expect(() => mk().add(Fixed, Bad).step(1)).toThrow('res.mut(Rng)')
  })
})

describe('dev guards', () => {
  test('writing a read-only row field throws with the fix', () => {
    const Bad = system([Transform, Velocity], ([t]) => {
      ;(t as any).x = 1
    })
    const app = mk().add(Fixed, Bad)
    app.spawn(Transform, Velocity)
    expect(() => app.step(1)).toThrow('Bad wrote Transform.x, but its query takes Transform read-only. Use Mut(Transform) in the query.')
  })

  test('writes through ctx.world are caught', () => {
    const CollectCoins = system(({ world }) => {
      world.spawn(Health)
    })
    expect(() => mk().add(Fixed, CollectCoins).step(1)).toThrow(
      'CollectCoins called world.spawn() through ctx.world, which is read-only. Use commands.spawn(...).',
    )
  })

  test('entity.set without Mut is caught', () => {
    const Sneaky = system({ hs: [Health] }, ({ hs }) => {
      hs.forEach((e) => e.set(Health, { hp: 0 }))
    })
    const app = mk().add(Fixed, Sneaky)
    app.spawn(Health)
    expect(() => app.step(1)).toThrow("Sneaky wrote Health with entity.set() but doesn't declare Mut(Health). Add Mut(Health) to its query.")
  })

  test('entity.set with Mut is allowed', () => {
    const Zero = system({ hs: [Mut(Health)] }, ({ hs }) => {
      hs.forEach((e) => e.set(Health, { hp: 0 }))
    })
    const app = mk().add(Fixed, Zero)
    const e = app.spawn(Health)
    app.step(1)
    expect(app.get(e, Health)!.hp).toBe(0)
  })

  test('writes to an entity.get() copy are caught', () => {
    const Lost = system({ hs: [Mut(Health)] }, ({ hs }) => {
      hs.forEach((e) => {
        e.get(Health)!.hp = 0
      })
    })
    const app = mk().add(Fixed, Lost)
    app.spawn(Health)
    expect(() => app.step(1)).toThrow('Lost wrote Health.hp on the copy entity.get() returns')
  })

  test('structural changes on entities inside systems are caught', () => {
    const Kill = system([Health], (_, { entity }) => entity.destroy())
    const app = mk().add(Fixed, Kill)
    app.spawn(Health)
    expect(() => app.step(1)).toThrow('Kill called entity.destroy() during Fixed. Use commands.despawn(entity)')
  })

  test('production mode skips the proxies', () => {
    const Direct = system(({ world }) => void world.spawn(Health))
    const app = mk({ dev: false }).add(Fixed, Direct)
    app.step(1)
    expect(app.query(Health).length).toBe(1)
  })

  test('errors thrown inside systems name the system and phase', () => {
    const Boom = system(() => {
      throw new Error('nope')
    })
    expect(() => mk().add(Update, Boom).step(1)).toThrow('Boom threw in Update: nope')
  })
})

describe('loop', () => {
  test('tick() runs 0..N fixed steps with the accumulator and clamps big deltas', () => {
    let fixed = 0
    let updates = 0
    const app = mk()
      .add(Fixed, system(() => void fixed++).named('F'))
      .add(Update, system(() => void updates++).named('U'))
    app.tick(0.008) // less than one step
    expect(fixed).toBe(0)
    app.tick(0.01) // 18ms total → 1 step
    expect(fixed).toBe(1)
    app.tick(10) // clamped to 250ms, capped at 5 steps
    expect(fixed).toBe(6)
    expect(updates).toBe(3)
    expect(app.time.alpha).toBeGreaterThanOrEqual(0)
    expect(app.time.alpha).toBeLessThan(1)
  })

  test('step(n) runs exactly n fixed steps and sim time is deterministic', () => {
    const app = mk({ fixedHz: 50 }).step(100)
    expect(app.time.tick).toBe(100)
    expect(app.time.elapsed).toBeCloseTo(2, 10)
  })

  test('startup runs once before the first step', () => {
    const order: string[] = []
    const app = mk()
      .add(Startup, system(() => void order.push('startup')).named('S'))
      .add(Fixed, system(() => void order.push('fixed')).named('F'))
      .add(Late, system(() => void order.push('late')).named('L'))
    app.step(2)
    expect(order).toEqual(['startup', 'fixed', 'late', 'fixed', 'late'])
  })

  test('async plugins must finish before step()', async () => {
    const Slow = plugin(async (app) => {
      await new Promise((r) => setTimeout(r, 5))
      app.init(Score)
    }, 'Slow')
    const app = mk().use(Slow)
    expect(() => app.step(1)).toThrow('await app.ready() first')
    await app.ready()
    app.step(1)
    expect(app.hasResource(Score)).toBe(true)
  })
})

describe('change tracking', () => {
  test('each system gets its own Changed tracker', () => {
    const Damage = system([Mut(Health), IsPlayer], ([h], { time }) => {
      if (time.tick === 1) h.hp -= 1
    })
    const seenA: number[] = []
    const seenB: number[] = []
    const A = system([Health, Changed(Health)], ([h]) => void seenA.push(h.hp))
    const B = system([Health, Changed(Health)], ([h]) => void seenB.push(h.hp))
    const app = mk().add(Fixed, chain(Damage, A, B))
    app.spawn(Health, IsPlayer)
    app.step(4)
    expect(seenA).toEqual([9])
    expect(seenB).toEqual([9])
  })
})

test('a thrown KilnError is a KilnError', () => {
  try {
    mk().add(Fixed, 42 as any)
  } catch (e) {
    expect(e).toBeInstanceOf(KilnError)
    expect((e as Error).message).toContain('Pass systems made with system()')
  }
})
