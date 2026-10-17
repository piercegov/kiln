import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Args } from './args.ts'
import { list, num } from './args.ts'
import { buildApp, loadGame } from './load.ts'
import { snapshotTraitsByName } from '../core/snapshot.ts'
import { KilnError } from '../core/errors.ts'
import { objectByName } from '../core/names.ts'
import { isResource } from '../core/resource.ts'
import { isEvent } from '../core/event.ts'
import type { ScriptEvent } from '../core/input-types.ts'

/**
 * kiln run --steps 600 --seed 1 --snapshot Health,Transform [--resources Score] [--script in.json]
 *          [--events Hit,Landed] [--precision 4] [--every 60] [--full] [--pretty]
 * Prints a JSON snapshot after N headless steps (one JSON line per sample with --every).
 * Struct fields at their default value are left out unless --full is passed.
 */
export default async function run(args: Args, root: string): Promise<number> {
  const steps = num(args.steps, 60)
  const overrides = args.seed !== undefined ? { seed: num(args.seed, 0) } : {}
  const game = await loadGame(root, overrides)
  const app = await buildApp(game)
  try {
    app.boot()
    const traits = list(args.snapshot)
    const traitList = traits.length ? snapshotTraitsByName(traits) : undefined
    const resNames = list(args.resources)
    const resources = resNames.length
      ? resNames.map((n) => {
          const r = app.resourceList().find((x) => x.name === n) ?? (objectByName(n) as any)
          if (!isResource(r)) {
            const known = app.resourceList().map((x) => x.name).join(', ')
            throw new KilnError('unknown-resource', `No resource named "${n}" (known: ${known}). Check the export name.`)
          }
          return r
        })
      : undefined
    const eventNames = list(args.events)
    const events = eventNames.map((n) => {
      const e = app.bus.registered().find((x) => x.name === n) ?? (objectByName(n) as any)
      if (!isEvent(e)) throw new KilnError('unknown-event', `No event named "${n}". Register it with app.init(${n}) or emit it once.`)
      return e
    })
    if (typeof args.script === 'string') {
      const script = JSON.parse(readFileSync(resolve(root, args.script), 'utf8')) as ScriptEvent[]
      app.input.script(script)
    }
    const precision = num(args.precision, 4)
    const every = num(args.every, 0)
    const sample = () => {
      const snap = app.snapshot({ traits: traitList, resources, precision, omitDefaults: args.full !== true }) as any
      if (events.length) {
        snap.events = Object.fromEntries(events.map((e) => [e.name, app.events(e)]))
      }
      return snap
    }
    if (every > 0) {
      for (let done = 0; done < steps; ) {
        const n = Math.min(every, steps - done)
        app.step(n)
        done += n
        console.log(JSON.stringify(sample()))
      }
    } else {
      app.step(steps)
      console.log(args.pretty ? JSON.stringify(sample(), null, 2) : JSON.stringify(sample()))
    }
    return 0
  } finally {
    app.dispose()
  }
}
