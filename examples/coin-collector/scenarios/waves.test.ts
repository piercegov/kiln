import { expect, scenario } from 'kiln-ecs/test'
import { Transform } from 'kiln-ecs'
import { IsCoin, IsPlayer, Level, Score, WaveCleared } from '../src/data.ts'

scenario('clearing a wave spawns the next one with two more coins', ({ app }) => {
  const player = app.query(IsPlayer)[0]!
  const cleared: number[] = []
  for (const coin of [...app.query(IsCoin)]) {
    const c = app.get(coin, Transform)!
    app.set(player, Transform, { x: c.x, z: c.z })
    app.step(1)
    cleared.push(...app.events(WaveCleared).map((w) => w.wave))
  }
  expect(app.res(Score).value).toBe(20)
  expect(cleared).toEqual([1])
  app.step(1)
  expect(app.res(Level).wave).toBe(2)
  expect(app.query(IsCoin)).toHaveLength(22)
})
