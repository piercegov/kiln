import { expect, scenario } from 'kiln/test'
import { distSq, Transform } from 'kiln'
import { IsPlayer, Level, Score } from '../../src/data.ts'

async function load() {
  const { IsEnemy, PlayerHit }: any = await import('../../src/data.ts')
  return { IsEnemy, PlayerHit }
}

scenario('three enemies start in arena corners', async ({ app }) => {
  const { IsEnemy } = await load()
  const enemies = app.query(IsEnemy)
  expect(enemies).toHaveLength(3)
  const h = app.res(Level).halfSize - 1
  for (const e of enemies) {
    const t = app.get(e, Transform)!
    expect(Math.abs(Math.abs(t.x) - h)).toBeLessThan(1e-6)
    expect(Math.abs(Math.abs(t.z) - h)).toBeLessThan(1e-6)
  }
})

scenario('enemies close in on the player at 2 units per second', async ({ app }) => {
  const { IsEnemy } = await load()
  const p = app.query(IsPlayer)[0]!
  const e = app.query(IsEnemy)[0]!
  const before = Math.sqrt(distSq(app.get(e, Transform)!, app.get(p, Transform)!))
  app.step(60)
  const after = Math.sqrt(distSq(app.get(e, Transform)!, app.get(p, Transform)!))
  expect(before - after).toBeCloseTo(2, 1)
})

scenario('touching an enemy resets score and sends the player home', async ({ app }) => {
  const { IsEnemy, PlayerHit } = await load()
  const p = app.query(IsPlayer)[0]!
  const e = app.query(IsEnemy)[0]!
  app.res(Score).value = 5
  const et = app.get(e, Transform)!
  app.set(p, Transform, { x: et.x + 0.3, z: et.z })
  app.step(1)
  expect(app.events(PlayerHit).length).toBe(1)
  expect(app.events(PlayerHit)[0]!.enemy).toBe(e)
  expect(app.res(Score).value).toBe(0)
  const t = app.get(p, Transform)!
  expect(Math.hypot(t.x, t.z)).toBeLessThan(0.2)
})
