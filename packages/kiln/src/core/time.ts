import { resource } from './resource.ts'

/** The app clock as a resource; systems usually read `ctx.time` instead. */
export const Time = resource((app) => app.time).named('Time')
