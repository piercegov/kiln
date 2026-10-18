import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Args } from './args.ts'
import { num } from './args.ts'
import { buildApp, loadGame } from './load.ts'
import { sampler } from './run.ts'
import { KilnError } from '../core/errors.ts'
import { asRecording, Replayer } from '../core/recording.ts'
import { diffSnapshots } from '../core/snapshot.ts'

/**
 * kiln replay recordings/x.json [--until N] [--every N] [--snapshot Trait,..] [--resources Res,..]
 *             [--events E,..] [--precision 4] [--full] [--pretty]
 * Replays a recorded session headless on the current code and prints one JSON object:
 * `replay` (frames played, the first checkpoint that stopped matching, how the end state compares
 * with the session's, the error if it threw) and `snapshot` (the state at the end).
 * Exits 1 if the replay threw (the recorded crash reproduced, or a new one).
 */
export default async function replay(args: Args, root: string): Promise<number> {
  const file = args._[0]
  if (!file) throw new KilnError('no-recording', 'kiln replay needs a recording: `kiln replay recordings/session-....json` (F8 in the dev server saves one).')
  const path = resolve(root, file)
  if (!existsSync(path)) throw new KilnError('no-recording', `No recording at ${path}. Recordings save to recordings/ in the game folder (F8 in the dev server).`)
  const rec = asRecording(JSON.parse(readFileSync(path, 'utf8')), file)
  const { seed, fixedHz, maxFrameDt, maxFixedSteps, mode } = rec.config
  const game = await loadGame(root, { seed, fixedHz, maxFrameDt, maxFixedSteps, mode })
  const app = await buildApp(game)
  const out = (v: unknown) => console.log(args.pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v))
  try {
    const replayer = new Replayer(app, rec)
    const sample = sampler(app, args)
    const until = Math.min(num(args.until, rec.frames), rec.frames)
    const every = num(args.every, 0)
    let threw: { frame: number; message: string; code?: string } | undefined
    try {
      if (every > 0) {
        while (replayer.frame < until) {
          await replayer.play(Math.min(replayer.frame + every, until))
          out({ frame: replayer.frame, snapshot: sample() })
        }
      } else await replayer.play(until)
    } catch (err) {
      const e = err as { message?: string; code?: string }
      threw = { frame: replayer.frame, message: e?.message ?? String(err), ...(e?.code ? { code: e.code } : {}) }
    }
    const status = replayer.status
    const summary: Record<string, unknown> = {
      frames: status.frames,
      of: status.total,
      checked: status.checked,
      divergedAt: status.divergedAt,
    }
    if (rec.final && !threw && replayer.done) {
      const now = app.snapshot({ precision: 4 })
      const d = diffSnapshots({ ...rec.final, resources: undefined }, now, 1e-3)
      summary.endMatches = d.same
      if (!d.same) {
        summary.endDiff = { added: d.added.length, removed: d.removed.length, changed: d.changed.slice(0, 10), changedCount: d.changed.length }
      }
    }
    if (status.recordedError) summary.recordedError = status.recordedError
    if (threw) {
      summary.threw = threw
      const r = status.recordedError
      summary.reproduced = !!r && r.frame === threw.frame && threw.message === r.message
    } else if (status.recordedError && replayer.done) summary.reproduced = false
    if (status.notes.length) summary.notes = status.notes
    out(every > 0 ? { replay: summary } : { replay: summary, snapshot: sample() })
    return threw ? 1 : 0
  } finally {
    app.dispose()
  }
}
