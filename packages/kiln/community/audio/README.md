# audio

Positional sounds tied to Transform, on Web Audio through Three.js (`AudioListener`,
`PositionalAudio`, `AudioLoader`). The listener rides on the Camera. Buffers are cached by URL.
Browsers keep audio suspended until the first click or key press; the plugin resumes it then.
Headless (tests, `kiln run`, scenarios) it does nothing and never throws. A missing or undecodable
file logs one `[audio]` warning and stays silent.

```ts
import { AudioPlugin, Sound, PlaySound } from './plugins/audio/index.ts'

app.use(CorePlugins, AudioPlugin)

// a looping sound at a place (put files in public/, they are served from '/'):
commands.spawn(Transform({ x: 4 }), Sound({ src: '/sfx/campfire.ogg', loop: true, refDistance: 3 }))
// a one-shot from any system:
events.emit(PlaySound, { src: '/sfx/coin.ogg', entity: player, volume: 0.8 })
```

Adds:
- `Sound` trait: src, volume, loop, autoplay, refDistance. Changing src swaps the sound.
- `PlaySound` event: `{ entity?, src, volume? }`; positional when the entity has a Transform.
- `AudioState` resource: `listener` (null headless), master `volume`, `failed` URLs.
- System (Update): `UpdateAudio`.
