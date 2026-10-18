import { expect, scenario } from 'kiln-ecs/test'
import { AnimationEvent, AnimationStateChanged, MeshRef, SpriteAnimator, Transform } from 'kiln-ecs'
import { Hits, IsDummy, IsHero } from '../src/data.ts'

const hero = (app: Parameters<Parameters<typeof scenario>[1]>[0]['app']) => app.query(IsHero)[0]!

scenario('standing still idles on the idle frames', ({ app }) => {
  app.step(60)
  const anim = app.get(hero(app), SpriteAnimator)!
  expect(anim.state).toBe('idle')
  expect(anim.frame).toBeGreaterThanOrEqual(0)
  expect(anim.frame).toBeLessThanOrEqual(3)
  expect(app.has(hero(app), MeshRef)).toBe(true)
})

scenario('running plays run, faces the way it goes, and every footstep kicks up one dust puff', ({ app }) => {
  const h = hero(app)
  app.input.script([{ frame: 1, hold: 'left', frames: 48 }])
  let steps = 0
  for (let i = 0; i < 6; i++) {
    app.step(8)
    steps += app.events(AnimationEvent).filter((e) => e.name === 'footstep').length
  }
  const anim = app.get(h, SpriteAnimator)!
  expect(anim.state).toBe('run')
  expect(anim.flipX).toBe(true)
  // run is 4 frames at 10 fps with footsteps on frames 0 and 2: one every 0.2 s from entry,
  // so 0, 0.2, 0.4, 0.6 and 0.8 s over the 48 steps.
  expect(steps).toBe(5)
  // Puffs live 0.25 s, so at most two are around at once.
  const puffs = app.query(SpriteAnimator).filter((e) => e !== h)
  expect(puffs.length).toBeGreaterThan(0)
  expect(puffs.length).toBeLessThanOrEqual(2)
})

scenario('a swing hits a dummy in reach once, on the hit frame, then returns to idle', ({ app }) => {
  const h = hero(app)
  const dummy = app.query(IsDummy).find((d) => app.get(d, Transform)!.x === 4)!
  app.set(h, Transform, { x: 3 })
  app.input.script([{ frame: 1, tap: 'fire' }])
  const states: string[] = []
  let frameAtHit = -1
  for (let i = 0; i < 30; i++) {
    const before = app.res(Hits).value
    app.step(1)
    for (const c of app.events(AnimationStateChanged)) states.push(c.to)
    if (before === 0 && app.res(Hits).value === 1) frameAtHit = app.get(h, SpriteAnimator)!.clipFrame
  }
  expect(app.res(Hits).value).toBe(1)
  // The hit lands on the step the sword's hit frame (2 of the attack clip) first shows.
  expect(frameAtHit).toBe(2)
  expect(states).toEqual(['attack', 'idle'])
  expect(app.get(dummy, Transform)!.sy).toBeCloseTo(1, 1)
})

scenario('a swing facing away misses', ({ app }) => {
  const h = hero(app)
  app.set(h, Transform, { x: 5 })
  app.get(h, SpriteAnimator)!.flipX = false
  app.input.script([{ frame: 1, tap: 'fire' }])
  app.step(30)
  // The dummy at 4 is behind; the one at 8 is out of reach.
  expect(app.res(Hits).value).toBe(0)
})

scenario('a jump rises, falls and lands back in idle', ({ app }) => {
  const h = hero(app)
  app.input.script([{ frame: 1, tap: 'jump' }])
  const states: string[] = []
  for (let i = 0; i < 60; i++) {
    app.step(1)
    for (const c of app.events(AnimationStateChanged)) states.push(c.to)
  }
  expect(states).toEqual(['rise', 'fall', 'idle'])
  expect(app.get(h, Transform)!.y).toBe(0)
})
