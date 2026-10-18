---
description: "Writing custom materials in TSL for WebGPURenderer, verified on Three.js 0.186.1."
---

# Shaders (TSL)

Kiln renders with `WebGPURenderer`, so custom materials are written in
[TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language), Three.js's node shading
language, which compiles to WGSL on WebGPU and GLSL on the WebGL2 fallback. Everything below is
verified on Three.js 0.186.1 by the vendored `water` plugin (`kiln add water` for a full working
example).

```ts
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'      // node materials come from three/webgpu
import { uniform, positionGeometry, sin, mix, smoothstep, normalize, varying,
  transformNormalToView, vec3, vec4, float, texture, uv, Fn } from 'three/tsl'

// Uniforms. Drive time from the deterministic sim clock, not TSL's wall-clock `time`.
const uTime = uniform(0)
const uHeight = uniform(0.3)
const uDeep = uniform(new THREE.Color(0x1b5e8c))
const uCrest = uniform(new THREE.Color(0x9fd8f0))
// in an Update system:  uTime.value = time.elapsed + (time.alpha - 1) * time.step

const mat = new MeshStandardNodeMaterial({ roughness: 0.3 })

// Vertex displacement: read the undisplaced vertex from positionGeometry.
const p = positionGeometry
const h = sin(p.x.mul(0.55).add(uTime.mul(1.1))).mul(uHeight)   // .add .mul .negate, JS numbers ok
mat.positionNode = vec3(p.x, p.y.add(h), p.z)

// Normals for displaced geometry are in view space; varying() computes them per vertex.
const dhdx = sin(p.x.mul(0.55).add(uTime.mul(1.1)).add(Math.PI / 2)).mul(uHeight).mul(0.55)
mat.normalNode = normalize(varying(transformNormalToView(normalize(vec3(dhdx.negate(), 1, 0)))))
// (or: new MeshStandardNodeMaterial({ flatShading: true }) for faceted normals)

// Colour: pass a vertex value to the fragment stage with varying(), blend with mix/smoothstep.
mat.colorNode = mix(uDeep, uCrest, smoothstep(uHeight.negate(), uHeight, varying(h)))

// Textures, tiled UVs, and reusable functions:
const tint = Fn(([c]: [any]) => c.mul(vec4(1, 1, float(0.5), 1)))
// mat.colorNode = tint(texture(myTexture, uv().mul(2)))

commands.spawn(Transform, MeshRef(new THREE.Mesh(new THREE.PlaneGeometry(20, 20, 64, 64).rotateX(-Math.PI / 2), mat)))
```

## Rules

- Plain `MeshStandardMaterial` and `MeshBasicMaterial` (including `vertexColors` and `flatShading`)
  work unchanged. Reach for node materials only when you need custom shading.
- Don't use `ShaderMaterial`, `onBeforeCompile` or GLSL strings; they don't run on WebGPU.
- Drive animated uniforms from `time.elapsed`, interpolated with `time.alpha` as above, so the same
  tick always renders the same frame.
- Building node materials headless (Bun, scenarios) is fine; nothing compiles until the first render.
- For per-instance data that changes every step, prefer `InstanceColor` or an
  `InstancedBufferAttribute` on the geometry.
