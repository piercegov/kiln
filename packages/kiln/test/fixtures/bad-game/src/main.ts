import { createApp, CorePlugins, Fixed, Mut, system, Transform } from '../../../../src/index.ts'

export const Movement = system([Mut(Transform)], () => {})
export const Knockback = system([Mut(Transform)], () => {})

export default () => createApp().use(CorePlugins).add(Fixed, Movement, Knockback)
