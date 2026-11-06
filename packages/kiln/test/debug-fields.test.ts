import { describe, expect, test } from 'bun:test'
import { FIELD_DEPTH, FIELD_LIMIT, fieldShape, fieldTree, isPlain } from '../src/plugins/debug/fields.ts'

describe('debug panel: object trait fields', () => {
  test('opens nested plain objects, listing their number, boolean and string fields', () => {
    const stats = { strength: { level: 20, xp: 3 }, agility: { level: 18, xp: 0 }, name: 'You', tried: true }
    expect(fieldTree(stats)).toEqual({
      leaves: ['name', 'tried'],
      children: [
        ['strength', { leaves: ['level', 'xp'], children: [], more: 0 }],
        ['agility', { leaves: ['level', 'xp'], children: [], more: 0 }],
      ],
      more: 0,
    })
  })

  test('opens arrays by index, and leaves out class instances and what holds nothing editable', () => {
    class Mesh {
      x = 1
    }
    expect(isPlain(new Mesh())).toBe(false)
    expect(isPlain(new Map())).toBe(false)
    expect(isPlain(Object.create(null))).toBe(true)
    expect(fieldTree(new Mesh())).toBeNull()
    expect(fieldTree({ mesh: new Mesh(), bodies: [new Mesh()], empty: {} })).toBeNull()
    const grid = { w: 2, stacks: [{ item: 'coin', count: 3 }], mesh: new Mesh() }
    expect(fieldTree(grid)).toEqual({ leaves: ['w'], children: [['stacks', { leaves: [], children: [['0', { leaves: ['item', 'count'], children: [], more: 0 }]], more: 0 }]], more: 0 })
  })

  test(`stops at ${FIELD_DEPTH} levels deep and ${FIELD_LIMIT} entries, counting what it left out`, () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < FIELD_DEPTH + 2; i++) deep = { v: 1, next: deep }
    let depth = 0
    for (let t = fieldTree(deep); t; t = t.children[0]?.[1] ?? null) depth++
    expect(depth).toBe(FIELD_DEPTH)
    const wide = Object.fromEntries(Array.from({ length: FIELD_LIMIT + 5 }, (_, i) => [`k${i}`, i]))
    const tree = fieldTree(wide)!
    expect(tree.leaves).toHaveLength(FIELD_LIMIT)
    expect(tree.more).toBe(5)
  })

  test("the shape changes with the layout, not the values, so a map's new entry rebuilds the fields", () => {
    const a = fieldShape(fieldTree({ fists: { level: 1 } }))
    expect(fieldShape(fieldTree({ fists: { level: 9 } }))).toBe(a)
    expect(fieldShape(fieldTree({ fists: { level: 1 }, sword: { level: 0 } }))).not.toBe(a)
  })
})
