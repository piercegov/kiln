import { plugin } from './plugin.ts'
import { Rng } from './rng.ts'
import { Time } from './time.ts'

/** Always on: Time and Rng resources. Transform, commands and events need no setup. */
export const CorePlugin = plugin((app) => {
  app.init(Time, Rng)
}, 'CorePlugin')
