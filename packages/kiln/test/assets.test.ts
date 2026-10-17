import { afterEach, expect, test } from 'bun:test'
import { App, Assets, createApp, CorePlugins, MeshRef, Model, Scene, Startup, system, Transform } from '../src/index.ts'
import { scenarioApp } from '../src/test/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
const root = `${import.meta.dir}/fixtures/game`

test('loads JSON and GLTF headlessly from public/, cached by path', async () => {
  const app = createApp().use(CorePlugins)
  apps.push(app)
  ;(globalThis as any).__KILN_ROOT__ = root
  const assets = app.res(Assets)
  const lvl = assets.json<{ level: number; coins: number }>('level.json')
  expect(lvl.ready).toBe(false)
  expect(assets.load('level.json')).toBe(lvl)
  const tri = assets.gltf('models/tri.gltf')
  await app.idle()
  expect(lvl.value).toEqual({ level: 1, coins: 5 })
  expect(tri.ready).toBe(true)
  expect(tri.value!.scene.children[0]!.name).toBe('Tri')
})

test('missing assets fail with a fix, without throwing into systems', async () => {
  const app = createApp().use(CorePlugins)
  apps.push(app)
  ;(globalThis as any).__KILN_ROOT__ = root
  const h = app.res(Assets).load('nope/ship.glb')
  await app.idle()
  expect(h.failed).toBe(true)
  expect(h.error).toContain('Put it in the game\'s public/ folder (public/nope/ship.glb)')
})

test('Model entities get a shared MeshRef instance once loaded; scenarios wait for startup loads', async () => {
  const SpawnShip = system(({ commands, res }) => {
    commands.spawn(Transform({ x: 4 }), Model(res.get(Assets).gltf('models/tri.gltf')))
  })
  const app = await scenarioApp({ app: () => createApp().use(CorePlugins).add(Startup, SpawnShip) }, root)
  apps.push(app)
  app.step(1)
  const [e] = app.query(Model, MeshRef)
  expect(e).toBeDefined()
  const obj = app.get(e!, MeshRef)!
  expect(obj.userData.kilnShared).toBe(true)
  expect(obj.parent).toBe(app.res(Scene))
  expect(obj.position.x).toBe(4)
})
