import { InputPlugin } from './input/index.ts'
import { RenderPlugin } from './render/index.ts'
import { CorePlugin } from '../core/core-plugin.ts'
import type { PluginLike } from '../core/plugin.ts'

/**
 * The plugins every game uses: core (Time, Rng), render, input. Render only draws once
 * app.start(canvas) runs; headless, its scene still tracks MeshRef objects.
 */
export const CorePlugins: PluginLike[] = [CorePlugin, RenderPlugin, InputPlugin]
