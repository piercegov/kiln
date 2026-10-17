/**
 * Headless scenario tests on bun test.
 *
 *   scenario('player falls and lands', ({ app }) => {
 *     const p = app.spawn(Player, { at: { x: 0, y: 5, z: 0 } })
 *     app.step(120)
 *     expect(app.get(p, Transform)!.y).toBeCloseTo(0.5, 1)
 *     expect(app.events(Landed)).toHaveLength(1)
 *   })
 *
 * The app comes from the game's entry (kiln.config.ts `entry`, default src/main.ts), built fresh
 * for every scenario, with async plugins awaited and Startup already run. It is disposed after.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { App, KilnConfig } from '../index.ts'
import { buildApp, loadGame } from '../cli/load.ts'

export { expect, describe }

export type AppFactory = () => App | Promise<App>

export interface ScenarioOptions {
  /** Builds the app. Default: the game's entry module. */
  app?: AppFactory
  /** Overrides config.seed for this scenario. */
  seed?: number
  /** Other config overrides (fixedHz, mode...). */
  config?: KilnConfig
  /** Run Startup before the body. Default true. */
  startup?: boolean
  /** Test timeout in ms. */
  timeout?: number
}

export interface ScenarioContext {
  app: App
}

let defaultFactory: AppFactory | null = null
const autoFactories = new Map<string, Promise<AppFactory>>()

/** Sets the app factory for scenarios in this process (e.g. from a bun preload). */
export function useScenarioApp(factory: AppFactory): void {
  defaultFactory = factory
}

/** The game root for a scenario file: the nearest folder above it with kiln.config.ts or src/main.ts. */
function findGameRoot(from: string | undefined): string {
  let dir = from ? dirname(from) : process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'kiln.config.ts')) || existsSync(join(dir, 'src/main.ts'))) return dir
    const up = dirname(dir)
    if (up === dir) return process.cwd()
    dir = up
  }
}

/** The file that called scenario(), from the stack. */
function callerFile(): string | undefined {
  const stack = new Error().stack ?? ''
  const here = import.meta.url.replace('file://', '')
  for (const line of stack.split('\n').slice(1)) {
    const m = line.match(/\(?((?:file:\/\/)?\/[^():]+):\d+(?::\d+)?\)?\s*$/)
    if (!m) continue
    const file = m[1]!.replace('file://', '')
    if (file === here || file.includes('/bun:') || file.includes('node_modules/bun')) continue
    return file
  }
  return undefined
}

function gameFactory(root: string): Promise<AppFactory> {
  let f = autoFactories.get(root)
  if (!f) autoFactories.set(root, (f = loadGame(root).then((g) => g.build)))
  return f
}

/** Builds an app the way scenario() does, for tests that manage their own lifecycle. */
export async function scenarioApp(options: ScenarioOptions = {}, root = findGameRoot(callerFile())): Promise<App> {
  const factory = options.app ?? defaultFactory ?? (await gameFactory(root))
  const overrides: KilnConfig = { ...options.config }
  if (options.seed !== undefined) overrides.seed = options.seed
  const g = globalThis as any
  const prev = g.__KILN_OVERRIDES__
  g.__KILN_OVERRIDES__ = Object.keys(overrides).length ? { ...prev, ...overrides } : prev
  let app: App
  try {
    app = await buildApp({ root, config: {}, entry: '', build: factory })
  } finally {
    g.__KILN_OVERRIDES__ = prev
  }
  if (options.startup !== false) app.boot()
  return app
}

type Body = (ctx: ScenarioContext) => void | Promise<void>

function make(runner: typeof test | typeof test.only | typeof test.skip) {
  return (name: string, fn: Body, options: ScenarioOptions = {}) => {
    const root = findGameRoot(callerFile())
    return runner(
      name,
      async () => {
        const app = await scenarioApp(options, root)
        try {
          await fn({ app })
        } finally {
          app.dispose()
        }
      },
      options.timeout,
    )
  }
}

/** A headless test: fresh app, Startup run, disposed after. */
export const scenario = Object.assign(make(test), { only: make(test.only), skip: make(test.skip) })
