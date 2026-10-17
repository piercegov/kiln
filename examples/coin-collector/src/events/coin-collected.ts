import { event, type Entity } from 'kiln'

/** A coin was picked up by `by`. Emitted in Fixed by CollectCoins. */
export const CoinCollected = event<{ coin: Entity; by: Entity }>()
