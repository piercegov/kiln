/**
 * What the debug panel can show and edit of an object trait's value (or any value): its number,
 * boolean and string fields, and the plain objects and arrays under it, to a limited depth. Class
 * instances (Three.js objects, Maps, physics handles) are left out, so `trait(() => new Mesh())`
 * stays a one-line "object" while `trait(() => ({ strength: { level: 20 } }))` opens up.
 */

/** How deep the panel follows nested plain objects. */
export const FIELD_DEPTH = 4

/** The most entries of one object or array the panel lists; the rest are counted in `more`. */
export const FIELD_LIMIT = 40

/** A value's editable fields (`leaves`), the plain objects under it that have some (`children`), and how many entries were left out past FIELD_LIMIT (`more`). */
export interface FieldTree {
  leaves: string[]
  children: [string, FieldTree][]
  more: number
}

/** Whether `v` is a plain object or array, one the panel can open up. */
export function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  if (Array.isArray(v)) return true
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Whether `v` is a value the panel binds as an editable field. */
export const isLeaf = (v: unknown): v is number | boolean | string => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'

/** The fields of `v` the panel can show, or null when there are none (not plain, or nothing editable anywhere under it). */
export function fieldTree(v: unknown, depth = 0): FieldTree | null {
  if (!isPlain(v)) return null
  const tree: FieldTree = { leaves: [], children: [], more: 0 }
  const keys = Object.keys(v)
  for (const k of keys.slice(0, FIELD_LIMIT)) {
    const x = v[k]
    if (isLeaf(x)) tree.leaves.push(k)
    else if (depth + 1 < FIELD_DEPTH) {
      const child = fieldTree(x, depth + 1)
      if (child) tree.children.push([k, child])
    }
  }
  tree.more = Math.max(0, keys.length - FIELD_LIMIT)
  return tree.leaves.length || tree.children.length || tree.more ? tree : null
}

/** The fields the panel shows for an object trait's value: as fieldTree, but a plain object with nothing to edit yet (an empty map) is an empty tree rather than null, so it gets a folder that fills in as the game adds to it. Null when it isn't plain. */
export function traitFields(v: unknown): FieldTree | null {
  return fieldTree(v) ?? (isPlain(v) ? { leaves: [], children: [], more: 0 } : null)
}

/** A key for a tree's layout (which fields and folders, not their values): the panel rebuilds an entity's fields when it changes, as when a map gains an entry. */
export function fieldShape(tree: FieldTree | null): string {
  if (!tree) return ''
  return `${tree.leaves.join(',')}|${tree.more}{${tree.children.map(([k, c]) => `${k}:${fieldShape(c)}`).join(';')}}`
}
