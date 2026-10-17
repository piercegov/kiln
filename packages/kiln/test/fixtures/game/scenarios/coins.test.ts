import { expect, scenario } from '../../../../src/test/index.ts'
import { Transform } from '../../../../src/index.ts'
import { IsPlayer, Score } from '../src/main.ts'

scenario('player walks right and collects all five coins', ({ app }) => {
  app.step(6 * 60)
  expect(app.res(Score).value).toBe(5)
  const p = app.query(IsPlayer)[0]!
  expect(app.get(p, Transform)!.x).toBeCloseTo(6, 5)
})

scenario('seed changes coin offsets but not the count', ({ app }) => {
  app.step(6 * 60)
  expect(app.res(Score).value).toBe(5)
}, { seed: 99 })
