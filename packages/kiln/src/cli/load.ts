import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { App, KilnConfig } from '../index.ts'
import { KilnError } from '../core/errors.ts'

export interface LoadedGame {
  root: string
  config: KilnConfig
  entry: string
  build: () => App | Promise<App>
}

/** Finds kiln.config.ts and the entry module whose default export builds the app. */
export async function loadGame(root: string, overrides: KilnConfig = {}): Promise<LoadedGame> {
  ;(globalThis as any).__KILN_OVERRIDES__ = Object.keys(overrides).length ? overrides : undefined
  ;(globalThis as any).__KILN_ROOT__ = root
  let config: KilnConfig = {}
  for (const name of ['kiln.config.ts', 'kiln.config.js', 'kiln.config.mjs']) {
    const p = resolve(root, name)
    if (existsSync(p)) {
      const mod = await import(pathToFileURL(p).href)
      config = mod.default ?? mod.config ?? {}
      break
    }
  }
  const entry = resolve(root, config.entry ?? 'src/main.ts')
  if (!existsSync(entry)) {
    throw new KilnError(
      'no-entry',
      `No game entry at ${entry}. Create it with \`export default () => createApp(config)...\`, or set entry in kiln.config.ts.`,
    )
  }
  const mod = await import(pathToFileURL(entry).href)
  const build = mod.default ?? mod.main ?? mod.build
  if (typeof build !== 'function') {
    throw new KilnError(
      'bad-entry',
      `${config.entry ?? 'src/main.ts'} must default-export a function that returns the app: \`export default () => createApp(config).use(CorePlugins).add(...)\`.`,
    )
  }
  return { root, config, entry, build }
}

/** Builds the app headlessly and waits for async plugins. */
export async function buildApp(game: LoadedGame): Promise<App> {
  const app = await game.build()
  if (!app || typeof (app as App).step !== 'function') {
    throw new KilnError('bad-entry', 'The entry function must return the app (the result of createApp(...)...), not call .start().')
  }
  await app.ready()
  return app
}
