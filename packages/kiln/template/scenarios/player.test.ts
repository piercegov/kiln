import { expect, scenario } from 'kiln/test'
import { Transform } from 'kiln'
import { IsPlayer } from '../src/traits/is-player.ts'

scenario('the player walks right while right is held', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  app.input.script([{ frame: 1, hold: 'right', frames: 60 }])
  app.step(60)
  expect(app.get(p, Transform)!.x).toBeCloseTo(5, 3)
})
