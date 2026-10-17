import { nameOf, setName, takePendingName } from './names.ts'

export const $event = Symbol.for('kiln.event')

/** A typed event channel: `event<{ a: Entity; b: Entity }>()`. */
export interface EventType<T = void> {
  readonly [$event]: true
  /** Phantom field carrying the payload type. */
  readonly __payload?: T
  readonly name: string
  named(name: string): this
}

/** Defines a typed event. Events live for two runs of the phase that emitted them. */
export function event<T = void>(): EventType<T> {
  const pendingName = takePendingName()
  const e: EventType<T> = {
    [$event]: true,
    get name() {
      return nameOf(e, 'Event')
    },
    named(name: string) {
      setName(e, name, true)
      return e
    },
  }
  if (pendingName) setName(e, pendingName)
  return e
}

export function isEvent(x: unknown): x is EventType<any> {
  return typeof x === 'object' && x !== null && (x as any)[$event] === true
}

export type Payload<E> = E extends EventType<infer T> ? T : never

interface Entry {
  seq: number
  data: unknown
  /** Cleanup cadence: which phase block it belongs to, and that block's run number. */
  block: number
  run: number
}

class Channel {
  entries: Entry[] = []
  seq = 0
}

/**
 * Double-buffered event storage. Each emitted event is tagged with the phase block that emitted
 * it and lives until that block has started twice more. A whole frame's Fixed steps count as one
 * block run, so readers in any phase see every event exactly once, however many steps ran.
 */
export class EventBus {
  private channels = new Map<EventType<any>, Channel>()
  private runs: number[] = []
  /** Block the next emit is attributed to. */
  currentBlock = 0
  /** Everything emitted during the current app.step() call, for tests. */
  private recorder = new Map<EventType<any>, unknown[]>()
  recording = false

  register(e: EventType<any>): void {
    if (!this.channels.has(e)) this.channels.set(e, new Channel())
  }

  registered(): EventType<any>[] {
    return [...this.channels.keys()]
  }

  private channel(e: EventType<any>): Channel {
    let c = this.channels.get(e)
    if (!c) {
      c = new Channel()
      this.channels.set(e, c)
    }
    return c
  }

  /** Called once per frame for each phase block that runs. Drops events two runs old. */
  beginBlock(block: number): void {
    const run = (this.runs[block] ?? 0) + 1
    this.runs[block] = run
    for (const c of this.channels.values()) {
      const entries = c.entries
      let w = 0
      for (let r = 0; r < entries.length; r++) {
        const en = entries[r]!
        if (en.block === block && en.run < run - 1) continue
        entries[w++] = en
      }
      entries.length = w
    }
  }

  emit(e: EventType<any>, data: unknown): void {
    const c = this.channel(e)
    const block = this.currentBlock
    c.entries.push({ seq: ++c.seq, data, block, run: this.runs[block] ?? 0 })
    if (this.recording) {
      let list = this.recorder.get(e)
      if (!list) this.recorder.set(e, (list = []))
      list.push(data)
    }
  }

  /** Reads events newer than `cursor`, writing into `out`. Returns the new cursor. */
  readInto(e: EventType<any>, cursor: number, out: unknown[]): number {
    const c = this.channel(e)
    out.length = 0
    for (const en of c.entries) if (en.seq > cursor) out.push(en.data)
    return c.seq
  }

  startRecording(): void {
    this.recorder.clear()
    this.recording = true
  }

  recorded<T>(e: EventType<T>): readonly T[] {
    return (this.recorder.get(e) as T[] | undefined) ?? []
  }

  clear(): void {
    for (const c of this.channels.values()) c.entries.length = 0
    this.recorder.clear()
  }
}

/** Per-system view of the event bus: `events.read(Hit)`, `events.emit(Hit, {...})`. */
export class Events {
  private cursors = new Map<EventType<any>, number>()
  private buffers = new Map<EventType<any>, unknown[]>()
  constructor(private bus: EventBus) {}

  /** Events of this type this reader hasn't seen yet. The array is reused; copy it to keep it. */
  read<T>(e: EventType<T>): readonly T[] {
    let out = this.buffers.get(e)
    if (!out) this.buffers.set(e, (out = []))
    const next = this.bus.readInto(e, this.cursors.get(e) ?? 0, out)
    this.cursors.set(e, next)
    return out as T[]
  }

  emit<T>(e: EventType<T>, ...data: T extends void ? [] : [T]): void {
    this.bus.emit(e, data[0])
  }
}
