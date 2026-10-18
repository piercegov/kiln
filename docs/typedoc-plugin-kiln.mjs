// Names TypeDoc's modules after the import paths games use ('kiln/physics', not 'plugins/physics').
import { Converter } from 'typedoc'

const NAMES = {
  index: 'kiln',
  'plugins/physics': 'kiln/physics',
  test: 'kiln/test',
  'tooling/vite': 'kiln/vite',
  browser: 'kiln/browser',
}

/** @param {import('typedoc').Application} app */
export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const mod of context.project.children ?? []) mod.name = NAMES[mod.name] ?? mod.name
  })
}
