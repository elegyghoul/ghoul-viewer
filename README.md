# GhoulViewer

1. Clone the repo into your site as `ghoul-viewer`. If your site serves a `public` folder, use `public/ghoul-viewer`.

```bash
git clone https://github.com/elegyghoul/ghoul-viewer.git ghoul-viewer
cd ghoul-viewer
```

2. Build it once.

```bash
npm install
npm run build
```

`npm install` downloads the build tools. `npm run build` writes the viewer into `dist/`.

3. Add this to your page. The viewer is 315×184.

```html
<div id="ghoul" style="width: 400px; height: 190px;"></div>
<script type="module" src="/ghoul-viewer/dist/embed.js" data-target="#ghoul" data-ghoul="469"></script>
```

`data-target` is the div. `data-ghoul` is the ghoul number (0–6665). Add `data-scale="fit"` to the script tag to scale the viewer to the div, up to 3×.

4. To update, in that folder:

```bash
git pull
npm run build
```

## Load a ghoul from your page

`data-ghoul` is the first id. To change it:

```js
const viewer = document.getElementById('ghoul').viewer;
await viewer.ready;
viewer.load(1200);
```

`load` takes a ghoul number from 0 to 6665.