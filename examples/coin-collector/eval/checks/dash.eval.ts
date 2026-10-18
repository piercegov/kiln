import { expect, scenario } from 'kiln-ecs/test'
import { Transform } from 'kiln-ecs'
import { IsPlayer, Level } from '../../src/data.ts'
import { PLAYER_SPEED } from '../../src/systems.ts'

async function dashModule(): Promise<any> {
  const m: any = await import('../../src/data.ts')
  if (!m.Dash) throw new Error('src/data.ts does not export Dash yet')
  return m
}

scenario('Dash is a trait exported from src/data.ts', async () => {
  const m = await dashModule()
  expect(typeof m.Dash).toBe('function')
})

scenario('a dash moves 3x faster for 12 steps, then cools down for a second', async ({ app }) => {
  await dashModule()
  const p = app.query(IsPlayer)[0]!
  // Start at the left wall so the run never reaches the right one.
  app.set(p, Transform, { x: -app.res(Level).halfSize })
  const x0 = app.get(p, Transform)!.x
  app.input.script([
    { frame: 1, hold: 'right', frames: 200 },
    { frame: 10, tap: 'sprint' },
    { frame: 40, tap: 'sprint' }, // inside the cooldown: ignored
  ])
  app.step(120)
  const travelled = app.get(p, Transform)!.x - x0
  const normal = PLAYER_SPEED * (120 / 60)
  const extra = 2 * PLAYER_SPEED * 0.2
  expect(travelled).toBeGreaterThan(normal + extra * 0.9)
  expect(travelled).toBeLessThan(normal + extra * 1.1)
})

scenario('dashing without move input does nothing', async ({ app }) => {
  await dashModule()
  const p = app.query(IsPlayer)[0]!
  app.input.script([{ frame: 2, tap: 'sprint' }])
  app.step(30)
  const t = app.get(p, Transform)!
  expect(Math.hypot(t.x, t.z)).toBeLessThan(1e-6)
})
