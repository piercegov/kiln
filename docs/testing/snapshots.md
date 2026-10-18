---
description: "The world as JSON: snapshot options, kiln run, diffs and restoring."
---

# Snapshots

A snapshot is the world as JSON. It is how an agent "sees" the game without a screenshot, and what
hot reload and `kiln run` use under the hood.

```ts
const snap = app.snapshot({ traits: [Transform, Health], resources: [Score], precision: 3 })
```

```json
{
  "tick": 60,
  "frame": 60,
  "entities": [
    { "id": 2, "gen": 0, "traits": { "Health": { "hp": 3 }, "Transform": { "x": 1.5, "y": 0.5, "z": 0 } } }
  ],
  "resources": { "Score": { "value": 2 } }
}
```

| Option | Default | |
|---|---|---|
| `traits` | every trait | Only these traits, and only entities with at least one of them |
| `resources` | none | A list, or `true` for every JSON-friendly resource |
| `precision` | exact | Round numbers to this many decimals |
| `omitDefaults` | `false` | Leave out struct fields equal to the trait's default |

Entities are sorted by id and trait keys by name. Struct traits are field objects, tags are `true`,
relations are arrays of target ids. Object traits are included when their value is JSON-friendly or
has `toJSON`; Three.js objects are always skipped. Entity ids are recycled, and `gen` tells reuses
apart.

## From the CLI

```bash
kiln run --steps 600 --snapshot Transform,Health --resources Score
kiln run --steps 600 --every 60 --snapshot Transform        # one JSON line per 60 steps
kiln run --steps 120 --script input.json --events Hit       # scripted input, events included
```

`kiln run` leaves out fields at their default (pass `--full` for everything) and rounds to 4
decimals (`--precision`).

## Diffing

```ts
const before = app.snapshot({ traits: [Transform] })
app.step(30)
const d = app.diff(before, app.snapshot({ traits: [Transform] }), 1e-6)
// d.same, d.added (entities), d.removed (ids), d.changed: [{ id, trait, field, from, to }], d.resources
```

Numbers within `epsilon` count as equal.

## Restoring

`app.restore(snap)` replaces every entity (and the listed resources) with the snapshot's. Traits are
matched by name, so a snapshot taken before a code change restores into the new code. Traits that no
longer exist come back in `missingTraits` rather than being lost silently. Entity ids are remapped and
relations follow the remap.
