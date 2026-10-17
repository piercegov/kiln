/**
 * Default dev flag. Vite builds set import.meta.env.PROD; elsewhere NODE_ENV=production turns dev off.
 * Core avoids Bun-only APIs.
 */
export function defaultDev(): boolean {
  const env = (import.meta as any).env
  if (env && typeof env.PROD === 'boolean') return !env.PROD
  const nodeEnv = (globalThis as any).process?.env?.NODE_ENV ?? env?.NODE_ENV
  return nodeEnv !== 'production'
}
