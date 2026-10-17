import { expect, scenario } from 'kiln/test'
import { Transform } from 'kiln'
import { PLAYER_SPEED } from '../src/systems/player-move.ts'
import { Level } from '../src/resources/level.ts'
import { IsPlayer } from '../src/traits/is-player.ts'

scenario('up moves away from the camera (-z) at PLAYER_SPEED', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  app.input.script([{ frame: 1, hold: 'up', frames: 60 }])
  app.step(60)
  expect(app.get(p, Transform)!.z).toBeCloseTo(-PLAYER_SPEED, 5)
})

scenario('the arena walls hold', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  app.input.press('right')
  app.step(600)
  expect(app.get(p, Transform)!.x).toBeCloseTo(app.res(Level).halfSize + 0.5, 5)
})
