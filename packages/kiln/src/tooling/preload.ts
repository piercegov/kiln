/**
 * Bun preload: registers the names transform for every .ts file outside node_modules.
 * Add to bunfig.toml: `[test] preload = ["kiln/preload"]`.
 */
import { plugin } from 'bun'
import { addNames } from './names.ts'

plugin({
  name: 'kiln-names',
  setup(build) {
    build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
      if (args.path.includes('/node_modules/') && !args.path.includes('/kiln/src/')) return undefined as never
      const code = await Bun.file(args.path).text()
      const out = addNames(code)
      return { contents: out ?? code, loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
    })
  },
})
