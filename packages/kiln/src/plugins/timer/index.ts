import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import { event, isEvent, type EventType } from '../../core/event.ts'
import type { Entity } from 'koota'
import { trait } from '../../core/koota.ts'
import { objectByName } from '../../core/names.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed } from '../../core/schedule.ts'
import { Mut } from '../../core/access.ts'
import { system } from '../../core/system.ts'

/** Fixed steps in `seconds`, at least 1. Timers count steps so they never drift. */
export function stepsFor(seconds: number, step: number): number {
  return Math.max(1, Math.round(seconds / step))
}

/**
 * A countdown on an entity, ticked every fixed step: `Timer({ duration: 2 })`, or
 * `Timer({ duration: 0.5, repeat: true })` for a repeating one. Read `justFinished` in Fixed (true for
 * exactly one step each time it completes), `finished` (stays true, one-shot only), `remaining` and
 * `elapsed` (seconds), `count` (completions). Set `paused` to hold it; `restartTimer(row)` resets it.
 * Each completion also emits `TimerFinished`, which Update systems should read instead.
 */
export const Timer = trait({
  duration: 1,
  repeat: false,
  paused: false,
  ticks: 0,
  elapsed: 0,
  remaining: 0,
  finished: false,
  justFinished: false,
  count: 0,
})

/** Despawns the entity `seconds` after it spawned: bullets, effects, popups. `Lifetime({ seconds: 2 })`. */
export const Lifetime = trait({ seconds: 1, ticks: 0 })

/** A Timer completed. Readers in any phase see each completion once. */
export const TimerFinished = event<{ entity: Entity; count: number }>()

/** Resets a Timer row (from a `Mut(Timer)` query) to start counting again, unpaused. */
export function restartTimer(t: { ticks: number; elapsed: number; finished: boolean; justFinished: boolean; paused: boolean }): void {
  t.ticks = 0
  t.elapsed = 0
  t.finished = false
  t.justFinished = false
  t.paused = false
}

interface Pending {
  due: number
  event: EventType<any>
  payload: unknown
}

/**
 * Events sent later: `res.mut(Delayed).emit(3, RoundStart, { round: 2 })` emits RoundStart 3 seconds
 * (of fixed steps) from now, in Fixed. `cancel(E)` drops pending ones. Survives snapshots when the
 * event is a named export.
 */
export class DelayedEvents {
  pending: Pending[] = []
  constructor(private readonly app: App) {}

  /** Emits `e` with `payload` after `seconds` of simulated time (at least one fixed step). */
  emit<T>(seconds: number, e: EventType<T>, ...payload: T extends void ? [] : [T]): void {
    if (!isEvent(e)) throw new KilnError('not-an-event', 'Delayed.emit(seconds, E, payload) needs an event made with event() as its second argument.')
    const t = this.app.time
    this.pending.push({ due: this.now() + stepsFor(seconds, t.step), event: e, payload: payload[0] })
  }

  /** Drops pending emits of `e` (or all of them). Returns how many were dropped. */
  cancel(e?: EventType<any>): number {
    const before = this.pending.length
    this.pending = e ? this.pending.filter((p) => p.event !== e) : []
    return before - this.pending.length
  }

  /** Seconds until the next pending `e`, or null. */
  timeLeft(e: EventType<any>): number | null {
    let best: number | null = null
    for (const p of this.pending) if (p.event === e && (best === null || p.due < best)) best = p.due
    return best === null ? null : (best - this.now()) * this.app.time.step
  }

  /** The last fixed step that has run: inside Fixed, time.tick is the step running now; elsewhere the next one. */
  private now(): number {
    const t = this.app.time
    return this.app.currentPhase === Fixed ? t.tick : t.tick - 1
  }

  toJSON() {
    return { pending: this.pending.map((p) => ({ due: p.due, event: p.event.name, payload: p.payload })) }
  }

  restore(json: { pending: { due: number; event: string; payload: unknown }[] }): void {
    this.pending = []
    for (const p of json.pending ?? []) {
      const e = objectByName(p.event)
      if (isEvent(e)) this.pending.push({ due: p.due, event: e, payload: p.payload })
    }
  }
}

export const Delayed = resource((app) => new DelayedEvents(app)).named('Delayed')

/**
 * Advances every Timer and Lifetime by one fixed step, emits TimerFinished on completion, despawns
 * expired Lifetimes and emits Delayed events that are due.
 */
export const TickTimers = system(
  { timers: [Mut(Timer)], lifetimes: [Mut(Lifetime)] },
  ({ timers, lifetimes }, { time, events, commands, res }) => {
    const step = time.step
    timers.each(([t], entity) => {
      const steps = stepsFor(t.duration, step)
      t.justFinished = false
      if (t.paused || (t.finished && !t.repeat)) {
        t.remaining = (steps - Math.min(t.ticks, steps)) * step
        return
      }
      t.finished = false
      t.ticks++
      if (t.ticks >= steps) {
        t.justFinished = true
        t.count++
        if (t.repeat) t.ticks = 0
        else {
          t.ticks = steps
          t.finished = true
        }
        events.emit(TimerFinished, { entity, count: t.count })
      }
      t.elapsed = t.ticks * step
      t.remaining = (steps - t.ticks) * step
    })
    lifetimes.each(([l], entity) => {
      if (++l.ticks >= stepsFor(l.seconds, step)) commands.despawn(entity)
    })
    if (res.get(Delayed).pending.length === 0) return
    const d = res.mut(Delayed)
    const due = d.pending.filter((p) => p.due <= time.tick)
    if (due.length === 0) return
    d.pending = d.pending.filter((p) => p.due > time.tick)
    for (const p of due) events.emit(p.event, p.payload as never)
  },
)

/**
 * Timers on entities (`Timer`, `Lifetime`) and delayed events (`Delayed`), all counted in fixed steps
 * so they are deterministic. Part of CorePlugins.
 */
export const TimerPlugin = plugin((app) => {
  app.init(Delayed, TimerFinished)
  app.add(Fixed, TickTimers)
}, 'TimerPlugin')
