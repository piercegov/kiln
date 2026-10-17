/** Default dev flag: on unless NODE_ENV is "production". Core avoids Bun-only APIs. */
export function defaultDev(): boolean {
  const env = (globalThis as any).process?.env?.NODE_ENV
  return env !== 'production'
}
