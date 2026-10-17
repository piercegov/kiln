import type { Args } from './args.ts'
import { buildApp, loadGame } from './load.ts'
import { formatDescription } from '../core/describe.ts'

/** kiln describe: the built schedule. Runs one headless step first so resource access is known. */
export default async function describe(args: Args, root: string): Promise<number> {
  const game = await loadGame(root)
  const app = await buildApp(game)
  try {
    app.build()
    if (args.run !== false) app.step(1)
    const d = app.describe()
    console.log(args.json ? JSON.stringify(d, null, 2) : formatDescription(d))
    return 0
  } finally {
    app.dispose()
  }
}
