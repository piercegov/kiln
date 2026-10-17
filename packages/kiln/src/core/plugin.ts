import type { App } from './app.ts'
import { nameOf, setName, takePendingName } from './names.ts'

export const $plugin = Symbol.for('kiln.plugin')

/** A function that adds resources, events and systems to the app, like a Bevy plugin. */
export interface Plugin {
  readonly [$plugin]: true
  readonly build: (app: App) => void | Promise<void>
  readonly name: string
  named(name: string): this
}

/**
 * Defines a plugin. It may be async (e.g. to init WASM); `app.ready()` waits for it and
 * `scenario()` does so for you.
 */
export function plugin(build: (app: App) => void | Promise<void>, name?: string): Plugin {
  const pendingName = takePendingName()
  const p: Plugin = {
    [$plugin]: true,
    build,
    get name() {
      return nameOf(p, build.name || 'Plugin')
    },
    named(n: string) {
      setName(p, n, true)
      return p
    },
  }
  if (pendingName) setName(p, pendingName)
  if (name) setName(p, name, true)
  return p
}

export function isPlugin(x: unknown): x is Plugin {
  return typeof x === 'object' && x !== null && (x as any)[$plugin] === true
}

export type PluginLike = Plugin | ((app: App) => void | Promise<void>) | readonly PluginLike[]
