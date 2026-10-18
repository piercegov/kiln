import { expect, scenario } from 'kiln/test'
import { Transform, Ui } from 'kiln'
import { Best, IsCoin, IsPlayer, Score, Screen } from '../src/data.ts'

scenario('pause freezes gameplay and shows a menu; Resume continues', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  app.input.tap('pause')
  app.step(2)
  expect(app.res(Screen).current).toBe('paused')
  expect(app.res(Ui).get('pause.title')?.text).toBe('Paused')
  app.input.press('right')
  app.step(30)
  expect(app.get(p, Transform)!.x).toBe(0)
  app.res(Ui).click('pause.resume')
  app.step(31)
  expect(app.res(Screen).current).toBe('playing')
  expect(app.res(Ui).has('pause.title')).toBe(false)
  expect(app.get(p, Transform)!.x).toBeGreaterThan(2)
})

scenario('coins pop in with a scale tween', ({ app }) => {
  const coin = app.query(IsCoin)[0]!
  app.step(1)
  expect(app.get(coin, Transform)!.sx).toBeLessThan(1)
  app.step(60)
  expect(app.get(coin, Transform)!.sx).toBe(1)
})

scenario('the HUD shows score and best', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  const coin = app.query(IsCoin)[0]!
  app.set(p, Transform, { ...app.get(coin, Transform)! })
  app.step(2)
  expect(app.res(Score).value).toBe(1)
  expect(app.res(Best).score).toBe(1)
  expect(app.res(Ui).get('score')?.text).toBe('Coins 1 · Wave 1')
  expect(app.res(Ui).get('best')?.text).toBe('Best 1')
})
