import type { Trait } from 'koota'
import { KilnError } from './errors.ts'
import { traitName } from './names.ts'
import { isChain, isEntry, isGate, isSystem, type Condition, type Schedulable, type System } from './system.ts'

export const $phase = Symbol.for('kiln.phase')
/** Marks a gate's unordered contents while it is being added. */
const GROUP = Symbol('kiln.group')

/** A slot in the frame. Systems get their phase when added: `app.add(Fixed, Movement)`. */
export interface Phase {
  readonly [$phase]: true
  readonly name: string
  readonly order: number
  /** Event cleanup cadence this phase's emits belong to. */
  readonly block: number
}

function phase(name: string, order: number, block: number): Phase {
  return Object.freeze({ [$phase]: true as const, name, order, block })
}

/** Once, before the first frame: spawn the level, load assets. */
export const Startup = phase('Startup', 0, 3)
/** Poll devices and write the Input resource. */
export const InputPhase = phase('Input', 1, 1)
/** 0..N times per frame at the fixed rate. Gameplay, physics, AI. */
export const Fixed = phase('Fixed', 2, 2)
/** Once per frame with variable dt. Cameras, UI state, non-gameplay animation. */
export const Update = phase('Update', 3, 3)
/** End of frame: last flush of commands and change events. */
export const Late = phase('Late', 4, 4)
/** Copies ECS state into Three.js and draws. Skipped when headless. */
export const Render = phase('Render', 5, 5)

export const PHASES: readonly Phase[] = [Startup, InputPhase, Fixed, Update, Late, Render]

export function isPhase(x: unknown): x is Phase {
  return typeof x === 'object' && x !== null && (x as any)[$phase] === true
}

/** One system as the schedule sees it. */
export interface Node {
  system: System
  index: number
  /** Systems that must run before this one. */
  afters: Set<System>
  /** Where the constraint came from, for error messages. */
  writes: ReadonlySet<Trait>
}

interface Edge {
  from: System
  to: System
  via: 'chain' | 'after' | 'before'
}

/** Collects `app.add()` calls for one phase. */
export class PhaseBuilder {
  readonly systems: System[] = []
  readonly edges: Edge[] = []
  /** Run conditions per system, from runIf() gates (outermost first). */
  readonly conditions = new Map<System, Condition[]>()
  private seen = new Set<System>()
  private gates: Condition[] = []

  constructor(readonly phase: Phase) {}

  add(item: Schedulable): void {
    this.addItem(item)
  }

  /** Returns the systems at the head and tail of an item, for chaining. */
  private addItem(item: Schedulable): { heads: System[]; tails: System[] } {
    if (isSystem(item)) {
      this.addSystem(item)
      return { heads: [item], tails: [item] }
    }
    if (isGate(item)) {
      this.gates.push(item.condition)
      try {
        return this.addItem(chainless(item.items))
      } finally {
        this.gates.pop()
      }
    }
    if (isEntry(item)) {
      this.addSystem(item.system)
      for (const a of item.afters) this.edges.push({ from: a, to: item.system, via: 'after' })
      for (const b of item.befores) this.edges.push({ from: item.system, to: b, via: 'before' })
      return { heads: [item.system], tails: [item.system] }
    }
    if (isChain(item)) {
      let first: System[] = []
      let prevTails: System[] = []
      item.items.forEach((child, i) => {
        const { heads, tails } = this.addItem(child)
        if (i === 0) first = heads
        for (const p of prevTails) for (const h of heads) this.edges.push({ from: p, to: h, via: 'chain' })
        prevTails = tails
      })
      return { heads: first, tails: prevTails }
    }
    if ((item as any)?.[GROUP]) {
      const heads: System[] = []
      const tails: System[] = []
      for (const child of (item as any).items as Schedulable[]) {
        const r = this.addItem(child)
        heads.push(...r.heads)
        tails.push(...r.tails)
      }
      return { heads, tails }
    }
    throw new KilnError(
      'not-schedulable',
      `app.add(${this.phase.name}, ...) got ${describeValue(item)}. Pass systems made with system(), chain(...) or system.after(...).`,
    )
  }

  private addSystem(s: System): void {
    if (this.seen.has(s)) {
      throw new KilnError(
        'duplicate-system',
        `${s.name} was added to ${this.phase.name} twice. Add each system once; use chain() or .after() for order.`,
      )
    }
    this.seen.add(s)
    this.systems.push(s)
    if (this.gates.length > 0) this.conditions.set(s, [...this.gates])
  }
}

/** Several unordered items treated as one for heads/tails (a gate's contents). */
function chainless(items: readonly Schedulable[]): Schedulable {
  if (items.length === 1) return items[0]!
  return { [GROUP]: true, items } as unknown as Schedulable
}

function describeValue(x: unknown): string {
  if (x === undefined) return 'undefined (is the import right?)'
  if (x === null) return 'null'
  if (typeof x === 'function') return `a function${x.name ? ` "${x.name}"` : ''} (wrap it: system(fn))`
  return typeof x
}

export interface BuiltPhase {
  phase: Phase
  /** Systems in run order. */
  order: System[]
  /** Direct predecessors of each system, for `kiln describe`. */
  afters: Map<System, System[]>
  /** Run conditions per gated system. */
  conditions: ReadonlyMap<System, Condition[]>
}

/**
 * Sorts a phase and validates it: unknown .after() targets, cycles, and two systems writing the
 * same trait with no order between them are errors here, at startup, not surprises at runtime.
 */
export function buildPhase(
  b: PhaseBuilder,
  writesOf: (s: System) => ReadonlySet<Trait>,
  phaseOf: (s: System) => Phase | undefined,
): BuiltPhase {
  const { systems, edges, phase } = b
  const index = new Map<System, number>()
  systems.forEach((s, i) => index.set(s, i))

  for (const e of edges) {
    const missing = !index.has(e.from) ? e.from : !index.has(e.to) ? e.to : null
    if (!missing) continue
    const owner = missing === e.from ? e.to : e.from
    const elsewhere = phaseOf(missing)
    const where = elsewhere ? `, it runs in ${elsewhere.name}` : ' (it was never added)'
    const rel = e.via === 'before' ? `.before(${missing.name})` : `.after(${missing.name})`
    throw new KilnError(
      'unknown-order-target',
      `${owner.name} in ${phase.name} uses ${rel}, but ${missing.name} isn't in ${phase.name}${where}. Add ${missing.name} to ${phase.name} or drop the ${rel}.`,
    )
  }

  const n = systems.length
  const preds: number[][] = Array.from({ length: n }, () => [])
  const succs: number[][] = Array.from({ length: n }, () => [])
  for (const e of edges) {
    const f = index.get(e.from)!
    const t = index.get(e.to)!
    if (f === t) {
      throw new KilnError('cycle', `${e.from.name} is ordered after itself in ${phase.name}. Remove that constraint.`)
    }
    if (!preds[t]!.includes(f)) {
      preds[t]!.push(f)
      succs[f]!.push(t)
    }
  }

  // Kahn's algorithm; ties go to insertion order so unconstrained systems keep add() order.
  const indeg = preds.map((p) => p.length)
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i)
  const order: number[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => a - b)
    const i = ready.shift()!
    order.push(i)
    for (const s of succs[i]!) if (--indeg[s]! === 0) ready.push(s)
  }
  if (order.length < n) {
    const cycle = findCycle(n, succs, indeg)
    const path = cycle.map((i) => systems[i]!.name).join(' → ')
    throw new KilnError(
      'cycle',
      `Systems in ${phase.name} form a cycle: ${path}. Remove one chain() link or .after()/.before() to break it.`,
    )
  }

  // Reachability for write-conflict checks.
  const reach: Set<number>[] = Array.from({ length: n }, () => new Set())
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!
    for (const s of succs[i]!) {
      reach[i]!.add(s)
      for (const r of reach[s]!) reach[i]!.add(r)
    }
  }
  for (let a = 0; a < n; a++) {
    const wa = writesOf(systems[a]!)
    if (wa.size === 0) continue
    for (let c = a + 1; c < n; c++) {
      if (reach[a]!.has(c) || reach[c]!.has(a)) continue
      const wc = writesOf(systems[c]!)
      for (const t of wa) {
        if (!wc.has(t)) continue
        const A = systems[a]!.name
        const C = systems[c]!.name
        const T = traitName(t)
        throw new KilnError(
          'write-conflict',
          `${A} and ${C} both take Mut(${T}) in ${phase.name} with no order. Put them in chain() or add .after().`,
        )
      }
    }
  }

  const afters = new Map<System, System[]>()
  systems.forEach((s, i) => afters.set(s, preds[i]!.map((p) => systems[p]!)))
  return { phase, order: order.map((i) => systems[i]!), afters, conditions: b.conditions }
}

function findCycle(n: number, succs: number[][], indeg: number[]): number[] {
  const inCycle = (i: number) => indeg[i]! > 0
  const start = [...Array(n).keys()].find(inCycle)!
  const path: number[] = []
  const pos = new Map<number, number>()
  let cur = start
  while (!pos.has(cur)) {
    pos.set(cur, path.length)
    path.push(cur)
    cur = succs[cur]!.find(inCycle)!
  }
  const cycle = path.slice(pos.get(cur))
  cycle.push(cur)
  return cycle
}
