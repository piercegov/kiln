# Kiln

An agent-first game framework on Three.js: a fixed-step loop, a [Koota](https://github.com/pmndrs/koota)
ECS, and a render bridge, designed so a coding agent can add a feature with a few exports and one
scheduling line, and verify it headlessly.

[![Docs](https://img.shields.io/badge/docs-read%20online-orange?style=for-the-badge&logo=readthedocs&logoColor=white)](https://kiln-docs-8zp.pages.dev)

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

## Repo

- `packages/kiln`: the framework (`kiln`, `kiln/physics`, `kiln/test`, `kiln/vite`, `kiln/browser`), the CLI,
  community plugins for `kiln add`, and the `kiln new` template.
- `examples/coin-collector`: the sample game, with `eval/` tasks for measuring agents.
- `docs/`: the documentation site (VitePress guides plus a TypeDoc API reference); `cd docs && bun install && bun run dev`.
  `docs/design.md` is how the build maps to the design doc.

## Develop

```bash
bun install
bun test                 # everything, including the example's scenarios
bun run typecheck
cd examples/coin-collector && bunx vite     # play it
```

Start a game: `bun packages/kiln/src/cli/kiln.ts new ../my-game`.
