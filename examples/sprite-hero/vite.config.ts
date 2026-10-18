import { defineConfig } from 'vite'
import { kiln } from 'kiln-ecs/vite'

export default defineConfig({ plugins: [kiln()] })
