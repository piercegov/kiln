import { expect, scenario, scenarioApp } from 'kiln/test'
import { Transform } from 'kiln'
import { IsCoin } from '../src/traits/is-coin.ts'

const script = [
  { frame: 1, hold: 'right', frames: 90 },
  { frame: 60, hold: 'up', frames: 120 },
  { frame: 200, axis: { x: -0.6, y: -0.8 } },
]

async function play(seed: number) {
  const app = await scenarioApp({ seed })
  app.input.script(script)
  app.step(400)
  const snap = app.snapshot({ traits: [Transform, IsCoin], resources: true, precision: 6 })
  app.dispose()
  return snap
}

scenario('same seed and input script, same world', async () => {
  expect(await play(7)).toEqual(await play(7))
})

scenario('the seed changes the coin layout', async () => {
  const a = await play(7)
  const b = await play(8)
  expect(a.entities.filter((e) => e.traits.IsCoin)).not.toEqual(b.entities.filter((e) => e.traits.IsCoin))
})
