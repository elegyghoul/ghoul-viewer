# GhoulViewer commands

Drop the viewer into any element. It fills that element.

## One line (after the script is on the page)

```html
<script type="module" src="/src/embed.ts"></script>
<ghoul-viewer ghoul="469"></ghoul-viewer>
```

Or mount into a div you already have:

```js
import { mountGhoulViewer } from './src/embed.ts';

const viewer = mountGhoulViewer(document.getElementById('my-div'), { id: 469 });
```

The host must have a size (`width` / `height` or flex). The canvas stretches to fill it.

Demo (no chrome): `/embed.html`

---

## Commands

`viewer` is whatever you name the object `mountGhoulViewer` returns. The same methods exist on `<ghoul-viewer>`.

### Ghoul

| Call | What it does |
|---|---|
| `load(id)` | Set ghoul number (0–6665) and load it |
| `getId()` | Current ghoul number |
| `reset()` | Reset pose and camera (same as studio Reset) |

### Mode

| Call | Values |
|---|---|
| `setMode(mode)` | `'view'` or `'play'` |
| `getMode()` | |
| `setCamera(mode)` | `'fixed'` or `'follow'` |
| `getCamera()` | |
| `setBackground(mode)` | `'grid'`, `'trait'`, or `'ghoulball'` |
| `getBackground()` | |
| `setAnim(name)` | `'Idle'` `'Walking'` `'Running'` `'Praying'` `'Dancing'` |
| `getAnim()` | |

### Lights

```js
viewer.setLights({
  master: 1,    // 0–5, scales ambient / hemi / key / fill
  ambient: 0,   // 0–1
  hemi: 0.74,   // 0–8
  key: 10.4,    // 0–12  (front point light)
  fill: 3.82,   // 0–10  (warm back light)
  sun: 1.35,    // 0–20  (directional, not scaled by master)
  sunAzimuth: 35,    // 0–360, heading the sun comes from
  sunElevation: 48,  // 5–85, rotation above the horizon
});
```

Pass only the keys you want to change. `getLights()` returns the current set. `resetLights()` restores the default mix (Ghoulball uses Master 5 / Ambient 0 / Hemi 0.18 / Key 12 / Fill 0).

### View (orbit camera)

`setCamera` is still play-mode `'fixed'` / `'follow'`. Framing uses these:

```js
viewer.setView({
  zoom: 2.8,                    // distance to look target (clamped 1–10)
  position: { x: 0, y: 1.1, z: 2.8 },
  rotation: { x: -12, y: 8, z: 0 },  // degrees, pitch / yaw / roll
});
```

Pass only the keys you want to change. Nested `position` / `rotation` can also be partial.

| Call | What it does |
|---|---|
| `setView({ ... })` | Zoom, position, and/or rotation |
| `getView()` | Current zoom, position, rotation |
| `resetView()` | Camera only — same as the Camera panel Reset |

### Follow camera

Used in Play + Follow. Pitch is also mouse-drag up/down.

```js
viewer.setFollow({
  pitch: 36,      // elevation, degrees (−7–69)
  yaw: 0,         // orbit around the ghoul, degrees
  distance: 3.51, // 1–10
});
```

`getFollow()` returns the current set. `resetFollow()` restores the default perch.

### Bloom

```js
viewer.setBloom({
  mode: 'objects',  // 'objects' (marked meshes) or 'screen' (whole image)
  strength: 0.10,   // 0–5
  radius: 0.11,     // 0–1
  threshold: 0.08,  // 0–1
});
```

Pass only the keys you want to change. `getBloom()` returns the current set. `resetBloom()` restores Objects mode and the default strength / radius / threshold.

### Ready

```js
await viewer.ready;   // models loaded, first ghoul on screen
viewer.load(12);
```

---

## Mount options

```js
const viewer = mountGhoulViewer(document.getElementById('my-div'), {
  id: 469,
  mode: 'view',          // 'view' | 'play'
  camera: 'fixed',       // 'fixed' | 'follow'
  background: 'trait',   // 'grid' | 'trait' | 'ghoulball'
  lights: { master: 1 },
  view: { zoom: 3 },
  bloom: { mode: 'screen' },
  anim: 'Idle',
  updateUrl: false,      // true = write ?id= into the address bar
});
```

## Custom element attributes

```html
<ghoul-viewer
  ghoul="469"
  mode="view"
  camera="fixed"
  background="trait"
></ghoul-viewer>
```

```js
const viewer = document.querySelector('ghoul-viewer');
viewer.load(100);
viewer.setMode('play');
viewer.setCamera('follow');
viewer.setBackground('ghoulball');
viewer.setLights({ key: 8, fill: 2 });
viewer.setView({ zoom: 4, rotation: { y: 30 } });
viewer.setBloom({ mode: 'screen', strength: 0.4 });
```

Studio editor (all panels) stays at `/`.
