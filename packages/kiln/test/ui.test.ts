import { afterEach, describe, expect, test } from 'bun:test'
import { App, createApp, CorePlugins, KilnError, system, Ui, UiClick, Update } from '../src/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
function mk() {
  const a = createApp().use(CorePlugins)
  apps.push(a)
  return a
}

describe('ui', () => {
  test('systems set elements; tests read them headless', () => {
    const Hud = system(({ res, time }) => {
      res.mut(Ui).text('frame', `Frame ${time.frame}`, { anchor: 'top-right', size: 16 })
      res.mut(Ui).bar('hp', 0.25, { label: 'HP' })
    })
    const app = mk().add(Update, Hud)
    app.step(3)
    const ui = app.res(Ui)
    expect(ui.get('frame')).toMatchObject({ kind: 'text', text: 'Frame 3', anchor: 'top-right', size: 16 })
    expect(ui.get('hp')).toMatchObject({ kind: 'bar', value: 0.25, text: 'HP' })
  })

  test('unchanged values do not bump the version; options persist across updates', () => {
    const app = mk()
    const ui = app.res(Ui)
    ui.text('score', 'Coins 1', { anchor: 'top', color: '#ff0' })
    const v = ui.version
    ui.text('score', 'Coins 1')
    expect(ui.version).toBe(v)
    ui.text('score', 'Coins 2')
    expect(ui.version).toBe(v + 1)
    expect(ui.get('score')).toMatchObject({ anchor: 'top', color: '#ff0', text: 'Coins 2' })
    ui.bar('x', 7)
    expect(ui.get('x')!.value).toBe(1)
  })

  test('clear(prefix), remove and show', () => {
    const ui = mk().res(Ui)
    ui.text('menu.title', 'Kiln')
    ui.button('menu.start', 'Start')
    ui.text('score', '0')
    ui.show('score', false)
    expect(ui.get('score')!.visible).toBe(false)
    ui.clear('menu.')
    expect(Object.keys(ui.nodes)).toEqual(['score'])
    ui.remove('score')
    expect(ui.has('score')).toBe(false)
  })

  test('click() and button actions emit UiClick once', () => {
    const app = mk()
    const ui = app.res(Ui)
    ui.button('start', 'Start', { anchor: 'center', action: 'jump' })
    ui.click('start')
    app.step(1)
    expect(app.events(UiClick)).toEqual([{ id: 'start' }])
    app.step(1)
    expect(app.events(UiClick)).toEqual([])
    app.input.tap('jump')
    app.step(2)
    expect(app.events(UiClick)).toEqual([{ id: 'start' }])
    ui.show('start', false)
    app.input.tap('jump')
    app.step(2)
    expect(app.events(UiClick)).toEqual([])
  })

  test('mistakes name the fix', () => {
    const ui = mk().res(Ui)
    expect(() => ui.click('nope')).toThrow(/no button 'nope'/)
    expect(() => ui.text('a', 'b', { anchor: 'middle' as any })).toThrow(KilnError)
  })

  test('res.get(Ui) is read-only in systems', () => {
    const Bad = system(({ res }) => (res.get(Ui) as any).text('x', 'y'))
    const app = mk().add(Update, Bad)
    expect(() => app.step(1)).toThrow(/res.mut\(Ui\)/)
  })

  test('snapshots carry the HUD and restore it', () => {
    const app = mk()
    app.res(Ui).text('score', 'Coins 4')
    const snap = app.snapshot({ resources: [Ui] }) as any
    expect(snap.resources.Ui.nodes.score.text).toBe('Coins 4')
    const b = mk()
    b.restore(snap)
    expect(b.res(Ui).get('score')!.text).toBe('Coins 4')
  })
})
