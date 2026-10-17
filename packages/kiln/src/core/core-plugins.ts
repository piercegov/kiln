import { InputPlugin } from '../plugins/input/index.ts'
import { CorePlugin } from './core-plugin.ts'
import type { PluginLike } from './plugin.ts'

/** The plugins every game uses. Render-only plugins do nothing when headless. */
export const CorePlugins: PluginLike[] = [CorePlugin, InputPlugin]
