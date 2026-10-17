import { resource } from 'kiln'

/** Level layout: arena half-size, coin count per wave, and the current wave number. */
export const Level = resource({ halfSize: 9, coins: 20, wave: 1 })
