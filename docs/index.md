---
layout: home

hero:
  name: Kiln
  text: An agent-first game runtime
  tagline: A fixed-step loop, a Koota ECS and a Three.js render bridge, built so a coding agent can add a feature with a few exports and one scheduling line, then check it headlessly.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why Kiln
      link: /guide/introduction
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Features are exports
    details: A trait, a system and one line in src/main.ts. Kiln names everything after its export, so file layout never matters and errors name the thing you wrote.
  - title: Mistakes fail at startup
    details: Two unordered systems writing the same trait, an .after() pointing at another phase, a write to a read-only trait. The schedule rejects them before the first frame, with the fix in the message.
  - title: Headless and deterministic
    details: The same seed and input script give the same world. Scenario tests step exact frames under bun test, and kiln run prints the world as JSON.
  - title: Eyes when you need them
    details: kiln shot renders one frame in headless Chromium. Play sessions record in the browser and replay frame for frame in a test.
  - title: Batteries included
    details: Input, assets, timers, tweens, a HUD, states, a camera rig, save slots, sprite and skeletal animation, and Rapier physics.
  - title: Docs for agents
    details: kiln docs writes an AGENTS.md from your code and its JSDoc. This site is also served as llms.txt and llms-full.txt.
---

```ts
// src/systems.ts
/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.z += v.z * time.step
})

// src/main.ts
export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement, CollectCoins))
```

```bash
kiln describe     # the schedule: phases, systems, reads/writes/order
kiln test         # headless scenario tests (bun test)
kiln run --steps 600 --snapshot Transform    # the world as JSON after 10 simulated seconds
kiln shot out.png # one frame from headless Chromium
kiln docs         # AGENTS.md from the code and its JSDoc
```
