import { expect, scenario } from 'kiln-ecs/test'
import { Transform } from 'kiln-ecs'
import { IsPlayer } from '../../src/data.ts'

async function load() {
  const { RoundTimer, RoundOver }: any = await import('../../src/data.ts')
  return { RoundTimer, RoundOver }
}

scenario('the timer counts down in simulated seconds', async ({ app }) => {
  const { RoundTimer } = await load()
  app.step(600)
  expect(app.res(RoundTimer).remaining).toBeCloseTo(50, 3)
})

scenario('RoundOver fires once at zero and input stops moving the player', async ({ app }) => {
  const { RoundTimer, RoundOver } = await load()
  let overs = 0
  for (let i = 0; i < 62; i++) {
    app.step(60)
    overs += app.events(RoundOver).length
  }
  expect(app.res(RoundTimer).remaining).toBe(0)
  expect(overs).toBe(1)
  const p = app.query(IsPlayer)[0]!
  const x0 = app.get(p, Transform)!.x
  app.input.press('right')
  app.step(60)
  expect(app.get(p, Transform)!.x).toBe(x0)
})
