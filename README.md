# GhoulViewer HTML5 (Three.js)

Barebones port of the Unity GhoulViewer: load a ghoul by number, show traits/accessories in Unity-authored positions, rotate with orbit controls, loop View-mode animations.

## Run

```bash
cd "HTML Version"
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Data pipeline

| File | Source |
|------|--------|
| `public/data/traits.json` | Parsed from `AllNFTGetter.prefab` via `tools/extract_traits.py`, or Unity menu **GhoulViewer → Export Web Data** |
| `public/data/attachment-map.json` | Prefab local TRS under `mixamorig:Head` (`tools/build_attachment_map.py` / Unity export) |
| `public/data/trait-rules.json` | Port of `GhoulStats.UpdateGhoul` |
| `public/models/*.glb` | FBX → GLB via Blender (`tools/fbx_to_glb.py`) |

### Re-export from Unity

1. Open the GhoulViewer scene (with `GhoulLibrary` / `GhoulStats` present).
2. Menu: **GhoulViewer → Export Web Data**
3. Writes into `HTML Version/public/data/`.

### Re-convert models

```bash
"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" --background --python tools/fbx_to_glb.py -- all
```

## Controls

- **Ghoul #** + Load — assemble traits for that NFT id
- **Anim** — Idle / Walking / Running / Praying / Dancing (View controller)
- Drag — orbit; scroll — zoom

## Spot-check IDs (vs Unity)

| Trait | Ghoul # |
|-------|---------|
| Cig | 35 |
| Cigs | 103 |
| Stogie | 5 |
| Red Halo | 21 |
| Cyclops + Blue Vipers | 1625 |
| Lil_B | 5977 |
| BlessedBeBased | 4791 |

```bash
npm run build
node ../tools/validate_web.mjs
```
