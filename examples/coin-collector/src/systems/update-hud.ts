import { system } from 'kiln'
import { Hud } from '../resources/hud.ts'
import { Level } from '../resources/level.ts'
import { Score } from '../resources/score.ts'

/** Writes score and wave into the HUD overlay. Does nothing headless. */
export const UpdateHud = system(({ res }) => {
  const { el } = res.get(Hud)
  if (!el) return
  const text = `Coins ${res.get(Score).value} · Wave ${res.get(Level).wave}`
  if (el.textContent !== text) el.textContent = text
})
