# Kiln repo

Kiln is an agent-first ECS game runtime on Three.js + Koota. Design doc: docs/design.md.

- Bun runs tests, scripts and the CLI: `bun test`, `bun run typecheck` (tsc). Vite serves the browser build.
- `packages/kiln/src/core` must not import Three.js or use `Bun.*` APIs (Node must keep working).
- Every error Kiln throws is a `KilnError` whose message names the fix.
- Tests live in `packages/kiln/test`; `*.typecheck.ts` files are compile-time checks only.
