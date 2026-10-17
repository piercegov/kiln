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
