#!/usr/bin/env bun
/**
 * The Kiln CLI, built for tool calls: short parseable output, `--json` everywhere.
 *   kiln describe            traits, systems (phase, reads, writes, order), plugins
 *   kiln run --steps 600     JSON snapshot after N headless steps
 *   kiln test                bun test over scenarios/
 *   kiln replay rec.json     replay a recorded play session headless
 *   kiln check               determinism lint (Math.random, Date.now in systems)
 *   kiln shot out.png        one rendered frame from headless Chromium
 *   kiln add <plugin>        copy a community plugin into src/plugins/
 *   kiln docs                write AGENTS.md (guide + generated game section)
 *   kiln new <dir>           create a game from the template
 */
import '../tooling/preload.ts'
import { parseArgs, type Args } from './args.ts'
import { KilnError } from '../core/errors.ts'

const HELP = `kiln <command> [options]

commands
  describe [--json] [--no-run]       traits, systems (phase, reads, writes, order), plugins
  run --steps N [--seed S] [--snapshot Trait,..] [--resources Res,..] [--json]
                                     headless run, prints a snapshot
  test [bun test args]               scenario tests (bun test scenarios/)
  replay <recording.json> [--until N] [--every N] [--snapshot Trait,..] [--events E,..]
                                     replay a recorded session (F8 in the dev server) headless;
                                     prints where it stopped matching and the end snapshot
  check [--json]                     determinism lint for src/
  shot [--steps N] [--seed S] [--width W] [--height H] out.png
                                     one rendered frame from headless Chromium
  add <plugin> [--list] [--force]    copy a community plugin into src/plugins/
  docs [--check]                     write AGENTS.md: the Kiln guide plus this game's schedule and JSDoc
  new <dir>                          create a game from the template

options
  --cwd DIR                          game folder (default: current directory)
  --json                             machine-readable output`

type Command = (args: Args, root: string) => Promise<number>

const commands: Record<string, () => Promise<{ default: Command }>> = {
  describe: () => import('./describe.ts'),
  run: () => import('./run.ts'),
  test: () => import('./test.ts'),
  replay: () => import('./replay.ts'),
  check: () => import('./check.ts'),
  shot: () => import('./shot.ts'),
  add: () => import('./add.ts'),
  docs: () => import('./docs.ts'),
  new: () => import('./new.ts'),
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const [cmd] = args._
  if (!cmd || cmd === 'help' || args.help) {
    console.log(HELP)
    return cmd ? 0 : 1
  }
  const load = commands[cmd]
  if (!load) {
    console.error(`error unknown-command: "${cmd}" is not a kiln command. Run \`kiln help\` for the list.`)
    return 1
  }
  args._.shift()
  const root = typeof args.cwd === 'string' ? args.cwd : process.cwd()
  try {
    const mod = await load()
    return await mod.default(args, root)
  } catch (err) {
    const code = err instanceof KilnError ? err.code : 'error'
    const message = err instanceof Error ? err.message : String(err)
    if (args.json) console.log(JSON.stringify({ error: { code, message } }))
    else {
      console.error(`error ${code}: ${message}`)
      if (!(err instanceof KilnError) && err instanceof Error && err.stack) console.error(err.stack)
    }
    return 1
  }
}

process.exit(await main(process.argv.slice(2)))
