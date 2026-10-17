import { resource } from 'kiln'

/** The score overlay element, or null when headless. */
export const Hud = resource(
  (): { el: HTMLDivElement | null } => {
    if (typeof document === 'undefined') return { el: null }
    const el = document.createElement('div')
    el.id = 'hud'
    el.style.cssText = 'position:fixed;left:16px;top:12px;color:#fff;font:600 20px/1.4 system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none'
    document.body.appendChild(el)
    return { el }
  },
  { readonlyProxy: false },
)
