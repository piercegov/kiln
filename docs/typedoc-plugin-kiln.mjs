// Names TypeDoc's modules after the import paths games use ('kiln-ecs/physics', not 'plugins/physics').
import { Converter } from 'typedoc'

const NAMES = {
  index: 'kiln-ecs',
  'plugins/physics': 'kiln-ecs/physics',
  test: 'kiln-ecs/test',
  'tooling/vite': 'kiln-ecs/vite',
  browser: 'kiln-ecs/browser',
}

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const mod of context.project.children ?? []) mod.name = NAMES[mod.name] ?? mod.name
  })
}
