import { relation as kootaRelation, trait as kootaTrait } from 'koota'
import { setName, takePendingName } from './names.ts'

/** Koota's trait(), unchanged except that Kiln learns its export name. */
export const trait: typeof kootaTrait = ((...args: unknown[]) => {
  const n = takePendingName()
  const t = (kootaTrait as any)(...args)
  if (n) setName(t, n)
  return t
}) as typeof kootaTrait

/** Koota's relation(), unchanged except that Kiln learns its export name. */
export const relation: typeof kootaRelation = ((...args: unknown[]) => {
  const n = takePendingName()
  const r = (kootaRelation as any)(...args)
  if (n) setName(r, n)
  return r
}) as typeof kootaRelation
