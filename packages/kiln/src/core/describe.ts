import { $internal, $relation, type Trait } from 'koota'
import type { App } from './app.ts'
import { namedTraits, traitName } from './names.ts'
import { PHASES } from './schedule.ts'

export interface TraitInfo {
  name: string
  storage: 'soa' | 'aos' | 'tag' | 'relation'
  /** Field names and defaults, for struct-of-arrays traits. */
  fields?: Record<string, unknown>
}

export interface SystemInfo {
  name: string
  form: 'none' | 'each' | 'named'
  reads: string[]
  writes: string[]
  /** Systems this one is ordered after (direct constraints). */
  after: string[]
  /** Resources seen at runtime. Empty until the app has run a step. */
  resources: { reads: string[]; writes: string[] }
}

export interface PhaseInfo {
  name: string
  systems: SystemInfo[]
}

/** The built app as data: what `kiln describe --json` prints. */
export interface AppDescription {
  config: Record<string, unknown>
  plugins: string[]
  phases: PhaseInfo[]
  traits: TraitInfo[]
  resources: string[]
  events: string[]
}

export function traitInfo(t: Trait): TraitInfo {
  if ((t as any)[$relation]) return { name: traitName(t), storage: 'relation' }
  const storage = t[$internal].type as TraitInfo['storage']
  const info: TraitInfo = { name: traitName(t), storage }
  if (storage === 'soa') {
    const fields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(t.schema as object)) fields[k] = typeof v === 'function' ? '(factory)' : v
    info.fields = fields
  }
  return info
}

export function describeApp(app: App): AppDescription {
  const schedule = app.schedule()
  const traits = new Set<Trait>()
  const phases: PhaseInfo[] = []
  for (const p of PHASES) {
    const built = schedule.get(p)!
    const compiled = app.systemsIn(p)
    const systems = compiled.map((cs): SystemInfo => {
      for (const t of cs.reads) traits.add(t)
      for (const t of cs.writes) traits.add(t)
      return {
        name: cs.name,
        form: cs.system.form,
        reads: [...cs.reads].map(traitName).sort(),
        writes: [...cs.writes].map(traitName).sort(),
        after: (built.afters.get(cs.system) ?? []).map((s) => s.name),
        resources: {
          reads: [...cs.resReads].filter((r) => !cs.resWrites.has(r)).map((r) => r.name).sort(),
          writes: [...cs.resWrites].map((r) => r.name).sort(),
        },
      }
    })
    if (systems.length > 0) phases.push({ name: p.name, systems })
  }
  for (const t of namedTraits().values()) traits.add(t)
  return {
    config: { ...app.config },
    plugins: app.pluginList.map((p) => p.name),
    phases,
    traits: [...traits].map(traitInfo).sort((a, b) => a.name.localeCompare(b.name)),
    resources: app.resourceList().map((r) => r.name),
    events: app.bus.registered().map((e) => e.name),
  }
}

/** Short, parseable text form of a description. */
export function formatDescription(d: AppDescription): string {
  const lines: string[] = []
  const c = d.config
  lines.push(`app mode=${c.mode} fixedHz=${c.fixedHz} seed=${c.seed}`)
  lines.push(`plugins ${d.plugins.join(', ') || '-'}`)
  for (const p of d.phases) {
    lines.push(`phase ${p.name}`)
    p.systems.forEach((s, i) => {
      const parts = [`  ${i + 1}. ${s.name}`]
      if (s.writes.length) parts.push(`writes ${s.writes.join(',')}`)
      if (s.reads.length) parts.push(`reads ${s.reads.join(',')}`)
      if (s.resources.writes.length) parts.push(`res-writes ${s.resources.writes.join(',')}`)
      if (s.resources.reads.length) parts.push(`res-reads ${s.resources.reads.join(',')}`)
      if (s.after.length) parts.push(`after ${s.after.join(',')}`)
      lines.push(parts.join(' | '))
    })
  }
  lines.push('traits')
  for (const t of d.traits) {
    const f = t.fields ? ' ' + Object.entries(t.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''
    lines.push(`  ${t.name} (${t.storage})${f}`)
  }
  lines.push(`resources ${d.resources.join(', ') || '-'}`)
  lines.push(`events ${d.events.join(', ') || '-'}`)
  return lines.join('\n')
}
