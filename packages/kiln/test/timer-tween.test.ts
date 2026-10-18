import { afterEach, describe, expect, test } from 'bun:test'
import {
  App,
  createApp,
  CorePlugins,
  Delayed,
  ease,
  event,
  Fixed,
  KilnError,
  Lifetime,
  TickTimers,
  Mut,
  resource,
  restartTimer,
  system,
  Timer,
  TimerFinished,
  Transform,
  TweenDone,
  Tweens,
} from '../src/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk(seed = 1) {
  const a = createApp({ seed }).use(CorePlugins)
  apps.push(a)
  return a
}

export const RoundStart = event<{ round: number }>()

describe('timers', () => {
  test('a one-shot timer finishes after exactly duration seconds of steps', () => {
    const app = mk()
    const e = app.spawn(Timer({ duration: 0.5 }))
    app.step(29)
    expect(app.get(e, Timer)!.finished).toBe(false)
    expect(app.get(e, Timer)!.remaining).toBeCloseTo(1 / 60, 9)
    app.step(1)
    const t = app.get(e, Timer)!
    expect([t.finished, t.justFinished, t.count, t.remaining]).toEqual([true, true, 1, 0])
    expect(app.events(TimerFinished)).toEqual([{ entity: e, count: 1 }])
    app.step(100)
    expect(app.get(e, Timer)!.justFinished).toBe(false)
    expect(app.events(TimerFinished)).toHaveLength(0)
  })

  test('repeating timers fire every duration and readers see each completion once', () => {
    const app = mk()
    let seen = 0
    const Reader = system([Timer], ([t]) => {
      if (t.justFinished) seen++
    })
    app.add(Fixed, Reader)
    app.spawn(Timer({ duration: 0.25, repeat: true }))
    app.step(60)
    expect(seen).toBe(4)
  })

  test('paused timers hold; restartTimer resets', () => {
    const app = mk()
    const e = app.spawn(Timer({ duration: 1 }))
    app.step(30)
    app.set(e, Timer, { paused: true })
    app.step(100)
    expect(app.get(e, Timer)!.ticks).toBe(30)
    const Restart = system([Mut(Timer)], ([t]) => restartTimer(t))
    app.add(Fixed, Restart.after(TickTimers))
    app.step(1)
    expect(app.get(e, Timer)!.ticks).toBe(0)
  })

  test('Lifetime despawns after its seconds', () => {
    const app = mk()
    const e = app.spawn(Transform, Lifetime({ seconds: 1 }))
    app.step(59)
    expect(app.world.has(e)).toBe(true)
    app.step(1)
    expect(app.world.has(e)).toBe(false)
  })

  test('Delayed emits events later, deterministically, and can be cancelled', () => {
    const app = mk().init(RoundStart)
    app.res(Delayed).emit(1, RoundStart, { round: 2 })
    app.res(Delayed).emit(2, RoundStart, { round: 3 })
    app.step(59)
    expect(app.res(Delayed).timeLeft(RoundStart)).toBeCloseTo(1 / 60, 9)
    app.step(1)
    expect(app.events(RoundStart)).toEqual([{ round: 2 }])
    expect(app.res(Delayed).cancel(RoundStart)).toBe(1)
    app.step(120)
    expect(app.events(RoundStart)).toHaveLength(0)
  })

  test('Delayed survives a snapshot', () => {
    const app = mk().init(RoundStart)
    app.res(Delayed).emit(0.5, RoundStart, { round: 7 })
    const snap = app.snapshot({ resources: [Delayed] })
    const b = mk().init(RoundStart)
    b.restore(snap)
    b.step(30)
    expect(b.events(RoundStart)).toEqual([{ round: 7 }])
  })

  test('Delayed.emit rejects non-events', () => {
    const app = mk()
    expect(() => (app.res(Delayed).emit as any)(1, {})).toThrow(KilnError)
  })
})


describe('tweens', () => {
  test('to() moves trait fields over duration with an ease', () => {
    const app = mk()
    const e = app.spawn(Transform({ x: 0 }))
    app.res(Tweens).to(e, Transform, { x: 10 }, { duration: 1, ease: 'linear' })
    app.step(30)
    expect(app.get(e, Transform)!.x).toBeCloseTo(5, 9)
    app.step(30)
    expect(app.get(e, Transform)!.x).toBe(10)
    expect(app.events(TweenDone)).toHaveLength(1)
    expect(app.res(Tweens).isTweening(e)).toBe(false)
  })

  test('delay, from, yoyo and repeat', () => {
    const app = mk()
    const e = app.spawn(Transform({ y: 3 }))
    app.res(Tweens).to(e, Transform, { y: 1 }, { duration: 0.5, delay: 0.5, from: { y: 0 }, yoyo: true, repeat: 1, ease: 'linear' })
    app.step(30)
    expect(app.get(e, Transform)!.y).toBe(3)
    app.step(30)
    expect(app.get(e, Transform)!.y).toBeCloseTo(1, 9)
    app.step(15)
    expect(app.get(e, Transform)!.y).toBeCloseTo(0.5, 9)
    app.step(15)
    expect(app.get(e, Transform)!.y).toBeCloseTo(0, 9)
    expect(app.events(TweenDone)).toHaveLength(1)
  })

  test('then() chains, despawn waits for the whole chain, tags reach TweenDone', () => {
    const app = mk()
    const e = app.spawn(Transform)
    app.res(Tweens)
      .to(e, Transform, { sx: 2 }, { duration: 0.25, tag: 'grow', despawn: true })
      .then(e, Transform, { sx: 0 }, { duration: 0.25, tag: 'shrink' })
    app.step(15)
    expect(app.events(TweenDone).map((d) => d.tag)).toEqual(['grow'])
    expect(app.world.has(e)).toBe(true)
    app.step(15)
    expect(app.events(TweenDone).map((d) => d.tag)).toEqual(['shrink'])
    expect(app.world.has(e)).toBe(false)
  })

  test('tweens queued on commands.spawn start once the entity exists', () => {
    const app = mk()
    const Spawner = system(({ commands, res, time }) => {
      if (time.tick !== 0) return
      const p = commands.spawn(Transform({ z: 0 }))
      res.mut(Tweens).to(p, Transform, { z: 6 }, { duration: 0.1, ease: 'linear' })
    })
    app.add(Fixed, Spawner)
    app.step(10)
    expect(app.get(app.query(Transform)[0]!, Transform)!.z).toBe(6)
  })

  test('a newer tween takes over the fields it animates', () => {
    const app = mk()
    const e = app.spawn(Transform)
    app.res(Tweens).to(e, Transform, { x: 10, y: 10 }, { duration: 1, ease: 'linear' })
    app.step(30)
    app.res(Tweens).to(e, Transform, { x: -5 }, { duration: 0.5, ease: 'linear' })
    app.step(30)
    const t = app.get(e, Transform)!
    expect(t.x).toBeCloseTo(-5, 9)
    expect(t.y).toBeCloseTo(10, 9)
  })

  test('plain objects (resources) tween too', () => {
    const Fade = resource({ alpha: 0 })
    const app = mk().init(Fade)
    app.res(Tweens).to(app.res(Fade), { alpha: 1 }, { duration: 0.5 })
    app.step(30)
    expect(app.res(Fade).alpha).toBe(1)
  })

  test('tweens on despawned entities are dropped quietly', () => {
    const app = mk()
    const e = app.spawn(Transform)
    app.res(Tweens).to(e, Transform, { x: 1 }, { duration: 1 })
    app.step(5)
    app.despawn(e)
    expect(() => app.step(5)).not.toThrow()
    expect(app.res(Tweens).active).toHaveLength(0)
    expect(app.events(TweenDone)).toHaveLength(0)
  })

  test('bad field and ease names name the fix', () => {
    const app = mk()
    const e = app.spawn(Transform)
    expect(() => app.res(Tweens).to(e, Transform, { x: 1 }, { ease: 'wobbly' as any })).toThrow(/Unknown ease 'wobbly'/)
    app.res(Tweens).to(e, Transform, { nope: 1 })
    expect(() => app.step(1)).toThrow(/no number field 'nope'/)
  })

  test('eases start at 0 and end at 1', () => {
    for (const [name, f] of Object.entries(ease)) {
      expect([name, f(0)]).toEqual([name, expect.closeTo(0, 9) as any])
      expect([name, f(1)]).toEqual([name, expect.closeTo(1, 9) as any])
    }
  })

  test('snapshots summarize running tweens', () => {
    const app = mk()
    const e = app.spawn(Transform)
    app.res(Tweens).to(e, Transform, { x: 1 }, { duration: 1, tag: 'slide' })
    app.step(30)
    const snap = app.snapshot({ resources: [Tweens] }) as any
    expect(snap.resources.Tweens.active[0]).toMatchObject({ trait: 'Transform', progress: 0.5, tag: 'slide' })
  })
})
