import { afterEach, expect, test } from 'bun:test'
import { App, chain, createApp, CorePlugins, Fixed, Mut, system, trait, Transform, Update } from '../src/index.ts'

const Velocity = trait({ x: 0, y: 0, z: 0 })
const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.y += v.y * time.step
})

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk() {
  const a = createApp({ seed: 1 }).use(CorePlugins)
  apps.push(a)
  return a
}

test('movement integrates', () => {
  const app = mk().add(Fixed, Movement)
  const e = app.spawn(Transform, Velocity({ x: 1, y: 2 }))
  app.step(60)
  expect(app.get(e, Transform)!.x).toBeCloseTo(1, 6)
  expect(app.get(e, Transform)!.y).toBeCloseTo(2, 6)
})

test('names come from the export', () => {
  expect(Movement.name).toBe('Movement')
})
