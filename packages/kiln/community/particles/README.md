# particles

Visual-only particle emitters. Each emitter entity gets one `THREE.InstancedMesh` holding all its
particles, simulated in Update in world space (moving the emitter doesn't drag live particles).
Particles are not entities, so they never show up in snapshots or queries. Each emitter forks its
own RNG from the app's seeded `Rng` the first frame it is seen, so runs replay exactly.

```ts
import { ParticlesPlugin, ParticleEmitter } from './plugins/particles/index.ts'

app.use(CorePlugins, ParticlesPlugin)

// in a Startup system (or on a torch prefab):
commands.spawn(Transform({ y: 1 }), ParticleEmitter({ rate: 60, lifetime: 1.2, speed: 3, spread: 0.4, size: 0.2, color: 0xffb347 }))
```

Adds:
- `ParticleEmitter` trait: rate (per second, 0 stops), lifetime, speed, spread (cone half-angle, radians), size, gravity, color, colorEnd, max.
- System (Update): `UpdateParticles`. Removing the trait or despawning the entity removes its mesh.
