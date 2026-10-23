import { expect, test } from 'bun:test'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'
import { kiln } from '../src/tooling/vite.ts'
import { findChromium } from '../src/cli/shot.ts'

test(
  'keyboard reaches systems through the action map in a real browser',
  async () => {
    const server = await createServer({
      root: `${import.meta.dir}/fixtures/input`,
      configFile: false,
      plugins: [kiln()],
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', hmr: false },
    })
    await server.listen()
    const addr = server.httpServer!.address() as { port: number }
    const browser = await chromium.launch({ executablePath: findChromium(chromium), headless: true, args: ['--use-angle=swiftshader'] })
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${addr.port}/?debug=0`)
      await page.waitForFunction(() => (window as any).__kiln_app?.isBooted)
      const read = () =>
        page.evaluate(() => {
          const app = (window as any).__kiln_app
          const snap = app.snapshot({ precision: 3 })
          return snap.entities[0].traits
        })
      await page.keyboard.down('KeyD')
      await page.waitForTimeout(400)
      await page.keyboard.up('KeyD')
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)
      const t = await read()
      expect(errors).toEqual([])
      expect(t.Transform.x).toBeGreaterThan(0.5)
      expect(t.Jumps.count).toBe(1)
    } finally {
      await browser.close()
      await server.close()
    }
  },
  60_000,
)

test(
  'pointer lock: Input.pointerLock takes the mouse on a click and movement reaches dx while locked',
  async () => {
    const server = await createServer({
      root: `${import.meta.dir}/fixtures/input`,
      configFile: false,
      plugins: [kiln()],
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', hmr: false },
    })
    await server.listen()
    const addr = server.httpServer!.address() as { port: number }
    const browser = await chromium.launch({ executablePath: findChromium(chromium), headless: true, args: ['--use-angle=swiftshader'] })
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${addr.port}/?debug=0`)
      await page.waitForFunction(() => (window as any).__kiln_app?.isBooted)
      const look = () => page.evaluate(() => (window as any).__kiln_app.snapshot({ precision: 3 }).entities[0].traits.Look)
      const setLock = (on: boolean) =>
        page.evaluate((on) => {
          const app = (window as any).__kiln_app
          app.resource(app.resourceList().find((r: { name: string }) => r.name === 'Input')).pointerLock = on
        }, on)
      await setLock(true)
      await page.mouse.click(200, 150)
      await page.waitForFunction(() => document.pointerLockElement?.tagName === 'CANVAS')
      await page.waitForTimeout(100)
      expect((await look()).locked).toBe(true)
      const before = (await look()).yaw
      // Headless Chromium re-centres a locked synthetic mouse (movement nets to 0), so send the
      // locked movement a real mouse produces: frozen clientX, motion in movementX, button -1 (a
      // plain move, no button change).
      await page.evaluate(() => {
        const c = document.querySelector('canvas')!
        for (let i = 0; i < 3; i++) c.dispatchEvent(new PointerEvent('pointermove', { movementX: 20, clientX: 5, button: -1, bubbles: true }))
      })
      await page.waitForTimeout(150)
      expect((await look()).yaw).toBeCloseTo(before + 0.6, 3)
      // A second button pressed and released while one is held arrives as pointermoves with
      // `button` set, and Chrome gives those a bogus movement (a real session recorded 113, -45 on
      // every one). They must not turn the view.
      await page.evaluate(() => {
        const c = document.querySelector('canvas')!
        const chord = (buttons: number) => new PointerEvent('pointermove', { movementX: 113, movementY: -45, clientX: 5, button: 0, buttons, bubbles: true })
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, button: 2, buttons: 2, bubbles: true }))
        c.dispatchEvent(chord(3))
        c.dispatchEvent(chord(2))
        c.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, button: 2, buttons: 0, bubbles: true }))
      })
      await page.waitForTimeout(150)
      expect((await look()).yaw).toBeCloseTo(before + 0.6, 3)
      await setLock(false)
      await page.waitForFunction(() => document.pointerLockElement === null)
      await page.waitForTimeout(100)
      expect((await look()).locked).toBe(false)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
      await server.close()
    }
  },
  60_000,
)

test(
  'a second mouse button pressed and released while another is held still reaches its action',
  async () => {
    const server = await createServer({
      root: `${import.meta.dir}/fixtures/input`,
      configFile: false,
      plugins: [kiln()],
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', hmr: false },
    })
    await server.listen()
    const addr = server.httpServer!.address() as { port: number }
    const browser = await chromium.launch({ executablePath: findChromium(chromium), headless: true, args: ['--use-angle=swiftshader'] })
    try {
      const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(`http://127.0.0.1:${addr.port}/?debug=0`)
      await page.waitForFunction(() => (window as any).__kiln_app?.isBooted)
      const down = () =>
        page.evaluate(() => {
          const app = (window as any).__kiln_app
          const input = app.resource(app.resourceList().find((r: { name: string }) => r.name === 'Input'))
          return { fire: input.down('fire'), alt: input.down('alt') }
        })
      const settle = () => page.waitForTimeout(150)
      await page.mouse.move(200, 150)
      // The browser sends the left press and the right release below as pointermoves, not pointerdown/up.
      await page.mouse.down({ button: 'right' })
      await page.mouse.down({ button: 'left' })
      await settle()
      expect(await down()).toEqual({ fire: true, alt: true })
      await page.mouse.up({ button: 'right' })
      await settle()
      expect(await down()).toEqual({ fire: true, alt: false })
      await page.mouse.up({ button: 'left' })
      await settle()
      expect(await down()).toEqual({ fire: false, alt: false })
      // And the other way round: the left release is the pointermove.
      await page.mouse.down({ button: 'right' })
      await page.mouse.down({ button: 'left' })
      await page.mouse.up({ button: 'left' })
      await settle()
      expect(await down()).toEqual({ fire: false, alt: true })
      await page.mouse.up({ button: 'right' })
      await settle()
      expect(await down()).toEqual({ fire: false, alt: false })
      expect(errors).toEqual([])
    } finally {
      await browser.close()
      await server.close()
    }
  },
  60_000,
)
