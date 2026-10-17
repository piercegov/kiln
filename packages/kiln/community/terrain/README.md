# terrain

A procedural heightfield: seeded fractal value noise (no Math.random), vertex colours blended from
`colorLow` to `colorHigh` by height, flat-shaded. `terrainHeightAt` samples the exact same function
headless, so gameplay can put things on the ground without the mesh.

```ts
import { TerrainPlugin, Terrain, terrainHeightAt } from './plugins/terrain/index.ts'

app.use(CorePlugins, TerrainPlugin)

const land = { size: 64, resolution: 96, height: 6, seed: 7, scale: 18, octaves: 4, colorLow: 0xd9c99a, colorHigh: 0x2f6b2f }
// in a Startup system:
commands.spawn(Transform, Terrain(land))
commands.spawn(Tree, { x: 3, y: terrainHeightAt(land, 3, -2), z: -2 })
```

Adds:
- `Terrain` trait: size, resolution (quads per side, 1..1024), height, seed, scale, octaves, colorLow, colorHigh. Changing any field rebuilds the geometry.
- `terrainHeightAt(params, x, z)`: height in local space (add the terrain's Transform if it moved).
- `buildTerrainGeometry(params)`: the BufferGeometry, if you want it elsewhere (e.g. a physics trimesh).
- Systems (Update): `BuildTerrain` (adds MeshRef via commands), `RebuildTerrain`.
