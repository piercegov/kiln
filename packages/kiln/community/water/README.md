# water

An animated water plane built with TSL (Three.js node shaders, WebGPU with WebGL2 fallback). Waves
are three summed sines displaced on the GPU in `positionNode`, with analytic normals in `normalNode`
and a trough-to-crest colour blend in `colorNode`. Time comes from the simulation clock
(`time.elapsed`, interpolated like RenderSync), so the same tick always renders the same waves.

```ts
import { WaterPlugin, Water, waterHeightAt } from './plugins/water/index.ts'

app.use(CorePlugins, WaterPlugin)

// in a Startup system:
commands.spawn(Transform({ y: 0.5 }), Water({ size: 80, segments: 160, waveHeight: 0.4, color: 0x1b5e8c }))
```

Adds:
- `Water` trait: size, segments, color, crestColor, waveHeight, waveSpeed, opacity. Changing size or segments rebuilds the plane; the rest update uniforms.
- `waterHeightAt(params, x, z, t)`: the same wave function on the CPU (for buoyancy, splashes).
- Systems (Update): `BuildWater` (adds MeshRef via commands), `AnimateWater` (pushes uniforms).
