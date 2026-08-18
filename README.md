# GhoulViewer

Pixel-dithered 3D viewer for Based Ghouls (ids **0–6665**). The page you want to copy is **`embed.html`**: window chrome, scene / camera / lighting / effects, and a canvas that fills the view.

## Pages

| URL | What it is |
|---|---|
| [`/embed.html`](embed.html) | Embeddable viewer (the chrome) |
| [`/embed.html?id=26`](embed.html?id=26) | Same, starting on a ghoul |
| [`/`](index.html) | Studio editor (all panels) |

`embed.html` scales with the browser width, up to 3× native size.

Full JS API: [COMMANDS.md](COMMANDS.md)

---

## iframe

Point at `embed.html` on a host that serves this app (models, palettes, and the Vite build).

```html
<iframe
  src="https://example.com/embed.html?id=469"
  title="GhoulViewer"
  style="width: 100%; max-width: 945px; aspect-ratio: 315 / 206; border: 0;"
></iframe>
```

Native chrome is **315×206**. At 3× that is **945×618**. Give the iframe a width; the page scales to fit.

---

## Custom element

Load the module, then drop a tag. The canvas **fills the element**, so the host needs a size.

```html
<script type="module" src="/src/embed.ts"></script>

<ghoul-viewer
  ghoul="469"
  mode="view"
  camera="fixed"
  background="trait"
></ghoul-viewer>
```

```css
ghoul-viewer {
  display: block;
  width: 465px;
  height: 465px;
}
```

Same methods as the mount API:

```js
const viewer = document.querySelector('ghoul-viewer');
await viewer.ready;
viewer.load(100);
viewer.setMode('play');
viewer.setCamera('follow');
viewer.setBackground('ghoulball');
```

---

## Mount into a div you already have

```js
import { mountGhoulViewer } from './src/embed.ts';

const viewer = mountGhoulViewer(document.getElementById('my-div'), {
  id: 469,
  mode: 'view',          // 'view' | 'play'
  camera: 'fixed',       // 'fixed' | 'follow'
  background: 'trait',   // 'grid' | 'trait' | 'ghoulball'
  anim: 'Idle',
  lights: { master: 1 },
  view: { zoom: 3 },
  bloom: { mode: 'screen' },
  fog: { near: 5, far: 30 },
  ball: { swirl: 0.4 },
});

await viewer.ready;
```

The div must have a size (`width` / `height` or flex). This path is the canvas only — no `embed.html` chrome.

---

## Commands (short)

`viewer` is the return value of `mountGhoulViewer`, or the `<ghoul-viewer>` element. Pass only the keys you want to change.

| Call | Notes |
|---|---|
| `load(id)` / `getId()` | Ghoul 0–6665 |
| `setMode('view' \| 'play')` | Play uses WASD-style tank controls |
| `setCamera('fixed' \| 'follow')` | Follow is play-mode third person |
| `setBackground('grid' \| 'trait' \| 'ghoulball')` | Trait uses the ghoul’s Background |
| `setAnim('Idle' \| 'Walking' \| 'Running' \| 'Praying' \| 'Dancing')` | |
| `setLights({ master, ambient, hemi, key, fill, sun, sunAzimuth, sunElevation })` | |
| `setView({ zoom, position, rotation })` | Orbit camera; rotation in degrees |
| `setFollow({ pitch, yaw, distance })` | Play + Follow |
| `setBloom({ mode, strength, radius, threshold })` | `mode`: `'objects'` \| `'screen'` |
| `setFog({ enabled, color, near, far })` | Trait backgrounds |
| `setBall({ rotation, spin, metalness, roughness, swirl })` | After `setBackground('ghoulball')` |
| `reset()` / `resetLights()` / `resetView()` / `resetFollow()` / `resetBloom()` / `resetFog()` / `resetBall()` | |

Ranges, defaults, and examples: [COMMANDS.md](COMMANDS.md).

---

## Run this repo

```bash
npm install
npm run dev
```

Then open `/embed.html`. `npm run build` emits a static site you can host as-is.
