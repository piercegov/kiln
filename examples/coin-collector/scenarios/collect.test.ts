import { expect, scenario } from 'kiln/test'
import { Transform } from 'kiln'
import { CoinCollected } from '../src/events/coin-collected.ts'
import { Score } from '../src/resources/score.ts'
import { IsCoin } from '../src/traits/is-coin.ts'
import { IsPlayer } from '../src/traits/is-player.ts'

scenario('walking onto a coin collects it', ({ app }) => {
  const player = app.query(IsPlayer)[0]!
  const coin = app.query(IsCoin)[0]!
  const c = app.get(coin, Transform)!
  // Stand one unit to the left of the coin, then walk right for half a second.
  app.set(player, Transform, { x: c.x - 1, z: c.z })
  app.input.script([{ frame: 1, hold: 'right', frames: 30 }])
  app.step(30)
  expect(app.res(Score).value).toBe(1)
  expect(app.events(CoinCollected).map((e) => e.coin)).toEqual([coin])
  expect(app.has(coin, IsCoin)).toBe(false)
})

scenario('standing still collects nothing', ({ app }) => {
  app.step(120)
  expect(app.res(Score).value).toBe(0)
  expect(app.query(IsCoin)).toHaveLength(20)
})
