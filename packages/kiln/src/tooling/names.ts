/**
 * The names transform, shared by kiln/vite and kiln/preload. For every
 * `const X = system|trait|resource|event|prefab|plugin|relation(...)`, at any depth, it announces
 * the name just before the factory runs (`void globalThis.__kiln_n?.("X") ?? system(...)`), and for
 * top-level ones it also appends `__kiln_name(X, "X")`. Kiln then names things after their export
 * in errors, snapshots and `kiln describe`. Only valid as a runtime transform: types are untouched.
 */
const FACTORIES = ['system', 'trait', 'resource', 'event', 'prefab', 'plugin', 'relation']
const DECL = String.raw`^([ \t]*)((?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*)(?=(?:[\w$]+\.)?(?:${FACTORIES.join('|')})\s*(?:<[^\n]*?>)?\s*\()`

export function findNamedExports(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(new RegExp(DECL, 'gm'))) if (m[1] === '') out.push(m[3]!)
  return out
}

export function addNames(code: string): string | null {
  let hit = false
  const out = code.replace(new RegExp(DECL, 'gm'), (_all, indent: string, decl: string, name: string) => {
    hit = true
    return `${indent}${decl}void globalThis.__kiln_n?.(${JSON.stringify(name)}) ?? `
  })
  if (!hit) return null
  const top = findNamedExports(code)
  const calls = top.map((n) => `globalThis.__kiln_name?.(${n}, ${JSON.stringify(n)});`).join('\n')
  return `${out}\n;${calls}\n`
}
