import type { ShotSetup } from 'kiln-ecs/browser'

// A kiln shot --setup module: runs on the started app before --input and the steps.
const advance: ShotSetup = (app) => {
  app.step(5)
}
export default advance
