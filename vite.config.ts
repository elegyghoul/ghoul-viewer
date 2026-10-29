import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type Connect } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const materialsPath = path.join(rootDir, 'src', 'materials.ts');

export type SaveMaterialsPayload = {
  skin?: Record<
    string,
    { light?: number; dark?: number; roughness?: number; metalness?: number }
  >;
  accent?: Record<
    string,
    {
      color: number;
      roughness?: number;
      metalness?: number;
      emissive?: number;
      emissiveIntensity?: number;
    }
  >;
  eye?: Record<string, { color: number }>;
  background?: Record<
    string,
    {
      color?: number;
      top?: number;
      bottom?: number;
      clouds?: number;
      distance?: number;
      tint?: number;
      pointColor?: number;
      pointIntensity?: number;
      columnsColor?: number;
      columnsRoughness?: number;
      columnsMetalness?: number;
    }
  >;
  backgroundFog?: Record<
    string,
    { enabled: boolean; color: number; near: number; far: number }
  >;
  backgroundRipple?: Record<
    string,
    { enabled: boolean; amplitude: number; frequency: number; speed: number }
  >;
  backgroundOceanMat?: Record<
    string,
    {
      color: number;
      metalness: number;
      roughness: number;
      opacity: number;
      envMapIntensity: number;
    }
  >;
  backgroundDirLight?: Record<
    string,
    {
      enabled: boolean;
      color: number;
      intensity: number;
      azimuth: number;
      elevation: number;
    }
  >;
};

function hexLiteral(n: number): string {
  return `0x${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

function finishLiteral(roughness?: number, metalness?: number): string {
  const parts: string[] = [];
  if (roughness != null) parts.push(`roughness: ${Number(roughness.toFixed(3))}`);
  if (metalness != null) parts.push(`metalness: ${Number(metalness.toFixed(3))}`);
  return `{ ${parts.join(', ')} }`;
}

function fogLiteral(entry: {
  enabled: boolean;
  color: number;
  near: number;
  far: number;
}): string {
  return `{ enabled: ${entry.enabled ? 'true' : 'false'}, color: ${hexLiteral(entry.color)}, near: ${Number(entry.near.toFixed(3))}, far: ${Number(entry.far.toFixed(3))} }`;
}

function rippleLiteral(entry: {
  enabled: boolean;
  amplitude: number;
  frequency: number;
  speed: number;
}): string {
  return `{ enabled: ${entry.enabled ? 'true' : 'false'}, amplitude: ${Number(entry.amplitude.toFixed(4))}, frequency: ${Number(entry.frequency.toFixed(3))}, speed: ${Number(entry.speed.toFixed(3))} }`;
}

function oceanMatLiteral(entry: {
  color: number;
  metalness: number;
  roughness: number;
  opacity: number;
  envMapIntensity: number;
}): string {
  return `{ color: ${hexLiteral(entry.color)}, metalness: ${Number(entry.metalness.toFixed(3))}, roughness: ${Number(entry.roughness.toFixed(3))}, opacity: ${Number(entry.opacity.toFixed(3))}, envMapIntensity: ${Number(entry.envMapIntensity.toFixed(3))} }`;
}

function dirLightLiteral(entry: {
  enabled: boolean;
  color: number;
  intensity: number;
  azimuth: number;
  elevation: number;
}): string {
  return `{ enabled: ${entry.enabled ? 'true' : 'false'}, color: ${hexLiteral(entry.color)}, intensity: ${Number(entry.intensity.toFixed(3))}, azimuth: ${Number(entry.azimuth.toFixed(1))}, elevation: ${Number(entry.elevation.toFixed(1))} }`;
}

function gradientLiteral(entry: { top: number; bottom: number; distance?: number }): string {
  const distance = entry.distance ?? 1;
  return `{ top: ${hexLiteral(entry.top)}, bottom: ${hexLiteral(entry.bottom)}, distance: ${Number(distance.toFixed(3))} }`;
}

function accentLiteral(entry: {
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
}): string {
  const parts = [`color: ${hexLiteral(entry.color)}`];
  if (entry.emissive != null) parts.push(`emissive: ${hexLiteral(entry.emissive)}`);
  if (entry.emissiveIntensity != null) {
    parts.push(`emissiveIntensity: ${Number(entry.emissiveIntensity.toFixed(3))}`);
  }
  if (entry.roughness != null) parts.push(`roughness: ${Number(entry.roughness.toFixed(3))}`);
  if (entry.metalness != null) parts.push(`metalness: ${Number(entry.metalness.toFixed(3))}`);
  return `{ ${parts.join(', ')} }`;
}

/** Replace or insert `Key: value,` inside `const Name = { ... };` */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find `key: <value>` in an object body. Value may be a single line or a
 * `{ ... }` block — previous single-line replace corrupted multi-line ACCENT
 * entries (e.g. tatteredCloak_1 with emissive).
 */
function findKeySpan(body: string, key: string): { start: number; end: number; indent: string } | null {
  const keyRe = new RegExp(`(^\\s*)${escapeRegExp(key)}\\s*:`, 'm');
  const m = keyRe.exec(body);
  if (!m || m.index == null) return null;
  const indent = m[1] ?? '  ';
  let i = m.index + m[0].length;
  while (i < body.length && /\s/.test(body[i]!)) i++;
  if (body[i] === '{') {
    let depth = 0;
    for (; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
  } else {
    // Hex / number / rgb(...) — do not stop on commas inside parentheses
    // (old bug left trails like `0.74, 0.74),` when replacing rgb values).
    let depth = 0;
    for (; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === '\n' && depth === 0) break;
    }
  }
  if (body[i] === ',') i++;
  while (i < body.length && (body[i] === '\r' || body[i] === ' ')) i++;
  // Keep same-line trailing comments with the replaced span when value ended at `,`
  // before `// ...`; if we already consumed to `\n`, just eat the newline.
  if (body[i] === '/' && body[i + 1] === '/') {
    while (i < body.length && body[i] !== '\n') i++;
  }
  if (body[i] === '\n') i++;
  return { start: m.index, end: i, indent };
}

function upsertInConstObject(src: string, constName: string, key: string, valueExpr: string): string {
  const constRe = new RegExp(`(const\\s+${constName}\\b[^=]*=\\s*\\{)([\\s\\S]*?)(\\n\\};)`);
  const match = src.match(constRe);
  if (!match) throw new Error(`Could not find const ${constName} in materials.ts`);

  const head = match[1]!;
  let body = match[2]!;
  const tail = match[3]!;
  const span = findKeySpan(body, key);
  const line = `${span?.indent ?? '  '}${key}: ${valueExpr},\n`;
  if (span) {
    body = body.slice(0, span.start) + line + body.slice(span.end);
  } else {
    const trimmed = body.replace(/\s*$/, '');
    const needsNewline = trimmed.length > 0 && !trimmed.endsWith('\n');
    body = `${trimmed}${needsNewline ? '\n' : ''}${line}`;
  }
  return src.replace(constRe, `${head}${body}${tail}`);
}

export function applyMaterialPatches(src: string, payload: SaveMaterialsPayload): string {
  let next = src;

  for (const [key, vals] of Object.entries(payload.skin ?? {})) {
    if (vals.light != null) {
      next = upsertInConstObject(next, 'SKIN', key, hexLiteral(vals.light));
    }
    if (vals.dark != null) {
      next = upsertInConstObject(next, 'SKIN_DARK', key, hexLiteral(vals.dark));
    }
    if (vals.roughness != null || vals.metalness != null) {
      next = upsertInConstObject(
        next,
        'SKIN_FINISH',
        key,
        finishLiteral(vals.roughness, vals.metalness),
      );
    }
  }

  for (const [key, vals] of Object.entries(payload.accent ?? {})) {
    // Preserve emissive* from an existing multi-line ACCENT entry if the UI
    // didn't send them (color/rough/metal edits shouldn't wipe glow).
    const constRe = /const\s+ACCENT\b[^=]*=\s*\{([\s\S]*?)\n\};/;
    const accentBody = next.match(constRe)?.[1] ?? '';
    const span = findKeySpan(accentBody, key);
    let emissive = vals.emissive;
    let emissiveIntensity = vals.emissiveIntensity;
    if (span && (emissive == null || emissiveIntensity == null)) {
      const block = accentBody.slice(span.start, span.end);
      if (emissive == null) {
        const em = block.match(/emissive:\s*(0x[0-9a-fA-F]+)/i);
        if (em) emissive = Number(em[1]);
      }
      if (emissiveIntensity == null) {
        const ei = block.match(/emissiveIntensity:\s*([0-9.]+)/);
        if (ei) emissiveIntensity = Number(ei[1]);
      }
    }
    next = upsertInConstObject(
      next,
      'ACCENT',
      key,
      accentLiteral({ ...vals, emissive, emissiveIntensity }),
    );
  }

  for (const [key, vals] of Object.entries(payload.eye ?? {})) {
    next = upsertInConstObject(next, 'EYE_COLORS', key, hexLiteral(vals.color));
  }

  for (const [key, vals] of Object.entries(payload.background ?? {})) {
    const top = vals.top ?? vals.color;
    const bottom = vals.bottom ?? vals.color;
    if (bottom != null) {
      next = upsertInConstObject(next, 'BACKGROUND', key, hexLiteral(bottom));
    } else if (top != null) {
      next = upsertInConstObject(next, 'BACKGROUND', key, hexLiteral(top));
    }
    if (top != null && bottom != null) {
      next = upsertInConstObject(
        next,
        'BACKGROUND_GRADIENT',
        key,
        gradientLiteral({ top, bottom, distance: vals.distance }),
      );
    }
    if (vals.clouds != null) {
      next = upsertInConstObject(next, 'BACKGROUND_CLOUDS', key, hexLiteral(vals.clouds));
    }
    if (vals.tint != null) {
      next = upsertInConstObject(next, 'BACKGROUND_SKY_TINT', key, hexLiteral(vals.tint));
    }
    if (vals.pointColor != null && vals.pointIntensity != null) {
      next = upsertInConstObject(
        next,
        'BACKGROUND_POINT_LIGHT',
        key,
        `{ color: ${hexLiteral(vals.pointColor)}, intensity: ${Math.round(vals.pointIntensity)} }`,
      );
    }
    if (
      vals.columnsColor != null &&
      vals.columnsRoughness != null &&
      vals.columnsMetalness != null
    ) {
      next = upsertInConstObject(
        next,
        'BACKGROUND_COLUMN_MAT',
        key,
        `{ color: ${hexLiteral(vals.columnsColor)}, roughness: ${Number(vals.columnsRoughness.toFixed(3))}, metalness: ${Number(vals.columnsMetalness.toFixed(3))} }`,
      );
    }
  }

  for (const [key, vals] of Object.entries(payload.backgroundFog ?? {})) {
    next = upsertInConstObject(next, 'BACKGROUND_FOG', key, fogLiteral(vals));
  }

  for (const [key, vals] of Object.entries(payload.backgroundRipple ?? {})) {
    next = upsertInConstObject(next, 'BACKGROUND_RIPPLE', key, rippleLiteral(vals));
  }

  for (const [key, vals] of Object.entries(payload.backgroundOceanMat ?? {})) {
    next = upsertInConstObject(next, 'BACKGROUND_OCEAN_MAT', key, oceanMatLiteral(vals));
  }

  for (const [key, vals] of Object.entries(payload.backgroundDirLight ?? {})) {
    next = upsertInConstObject(next, 'BACKGROUND_DIR_LIGHT', key, dirLightLiteral(vals));
  }

  return next;
}

function readJsonBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const redgradientPath = path.join(rootDir, '../Assets/Resources/Materials/redgradient.png');

/** Dev serves the Unity PNG live. The GLB only has a baked copy of it. */
function redgradientPlugin(): Plugin {
  return {
    name: 'nc69-redgradient',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/textures/redgradient.png') {
          next();
          return;
        }
        if (!fs.existsSync(redgradientPath)) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(redgradientPath).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(redgradientPath)) return;
      const outDir = path.join(rootDir, 'dist/textures');
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(redgradientPath, path.join(outDir, 'redgradient.png'));
    },
  };
}

function sanitizeClothWeights(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('expected an object');
  }
  const hitchBones = new Set([
    'mixamorigLeftArm',
    'mixamorigLeftForeArm',
    'mixamorigLeftHand',
    'mixamorigRightArm',
    'mixamorigRightForeArm',
    'mixamorigRightHand',
  ]);
  const out: Record<string, unknown> = {};
  for (const [family, entries] of Object.entries(payload as Record<string, unknown>)) {
    if (!/^[a-z0-9_]+$/i.test(family)) continue;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    if (family === 'hitches') {
      const hitches: Record<string, Record<string, string | null>> = {};
      for (const [cloak, bones] of Object.entries(entries as Record<string, unknown>)) {
        if (!/^[a-z0-9_]+$/i.test(cloak)) continue;
        if (!bones || typeof bones !== 'object' || Array.isArray(bones)) continue;
        const bucket: Record<string, string | null> = {};
        for (const [id, raw] of Object.entries(bones as Record<string, unknown>)) {
          if (!/^\d+$/.test(id)) continue;
          if (raw == null || raw === '') {
            bucket[id] = null;
            continue;
          }
          if (typeof raw === 'string' && hitchBones.has(raw)) bucket[id] = raw;
        }
        if (Object.keys(bucket).length > 0) hitches[cloak] = bucket;
      }
      if (Object.keys(hitches).length > 0) out.hitches = hitches;
      continue;
    }
    if (family === 'hitchDist') {
      const dists: Record<string, Record<string, number>> = {};
      for (const [cloak, perCloak] of Object.entries(entries as Record<string, unknown>)) {
        if (!/^[a-z0-9_]+$/i.test(cloak)) continue;
        if (!perCloak || typeof perCloak !== 'object' || Array.isArray(perCloak)) continue;
        const bucket: Record<string, number> = {};
        for (const [id, raw] of Object.entries(perCloak as Record<string, unknown>)) {
          if (!/^\d+$/.test(id)) continue;
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          bucket[id] = Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
        }
        if (Object.keys(bucket).length > 0) dists[cloak] = bucket;
      }
      if (Object.keys(dists).length > 0) out.hitchDist = dists;
      continue;
    }
    if (family === 'hitchFollow') {
      const follows: Record<string, Record<string, number>> = {};
      for (const [cloak, perCloak] of Object.entries(entries as Record<string, unknown>)) {
        if (!/^[a-z0-9_]+$/i.test(cloak)) continue;
        if (!perCloak || typeof perCloak !== 'object' || Array.isArray(perCloak)) continue;
        const bucket: Record<string, number> = {};
        for (const [id, raw] of Object.entries(perCloak as Record<string, unknown>)) {
          if (!/^\d+$/.test(id)) continue;
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          bucket[id] = Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
        }
        if (Object.keys(bucket).length > 0) follows[cloak] = bucket;
      }
      if (Object.keys(follows).length > 0) out.hitchFollow = follows;
      continue;
    }
    const bucket: Record<string, number> = {};
    for (const [id, raw] of Object.entries(entries as Record<string, unknown>)) {
      if (!/^\d+$/.test(id)) continue;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) continue;
      bucket[id] = Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
    }
    if (Object.keys(bucket).length > 0) out[family] = bucket;
  }
  return out;
}

type ClothGroupFile = {
  groups?: {
    id?: unknown;
    name?: unknown;
    members?: unknown;
  }[];
};

/** Dev-only group lists. The live site never receives this route. */
function sanitizeClothGroups(data: unknown): { groups: { id: string; name: string; members: Record<string, number[]> }[] } {
  const groups: { id: string; name: string; members: Record<string, number[]> }[] = [];
  const raw = data && typeof data === 'object' ? (data as ClothGroupFile).groups : null;
  if (!Array.isArray(raw)) return { groups };
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    if (groups.length >= 80) break;
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || seen.has(id)) continue;
    const nameRaw = typeof entry.name === 'string' ? entry.name : '';
    const name = nameRaw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    if (!name) continue;
    const members: Record<string, number[]> = {};
    if (entry.members && typeof entry.members === 'object' && !Array.isArray(entry.members)) {
      for (const [family, ids] of Object.entries(entry.members as Record<string, unknown>)) {
        if (!/^[a-z0-9_]+$/i.test(family)) continue;
        if (!Array.isArray(ids)) continue;
        const clean: number[] = [];
        const have = new Set<number>();
        for (const idRaw of ids) {
          const n = typeof idRaw === 'number' ? idRaw : Number(idRaw);
          if (!Number.isInteger(n) || n < 0 || n > 1_000_000 || have.has(n)) continue;
          have.add(n);
          clean.push(n);
          if (clean.length >= 20000) break;
        }
        if (clean.length > 0) members[family] = clean;
      }
    }
    seen.add(id);
    groups.push({ id, name, members });
  }
  return { groups };
}

/** Writes public/data/cloth-particle-weights.json so a reload and a production build keep it. */
function saveClothWeightsPlugin(): Plugin {
  const weightsPath = path.join(rootDir, 'public', 'data', 'cloth-particle-weights.json');
  return {
    name: 'save-cloth-weights',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__dev/save-cloth-weights') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'POST only' }));
          return;
        }
        try {
          const raw = await readJsonBody(req);
          const clean = sanitizeClothWeights(JSON.parse(raw) as unknown);
          fs.mkdirSync(path.dirname(weightsPath), { recursive: true });
          fs.writeFileSync(weightsPath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
          console.log('[save-cloth-weights] wrote', weightsPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

/** Writes public/data/cloth-particle-groups.json. Registered only on the Vite dev server. */
function saveClothGroupsPlugin(): Plugin {
  const groupsPath = path.join(rootDir, 'public', 'data', 'cloth-particle-groups.json');
  return {
    name: 'save-cloth-groups',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__dev/save-cloth-groups') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'POST only' }));
          return;
        }
        try {
          const raw = await readJsonBody(req);
          const clean = sanitizeClothGroups(JSON.parse(raw) as unknown);
          fs.mkdirSync(path.dirname(groupsPath), { recursive: true });
          fs.writeFileSync(groupsPath, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
          console.log('[save-cloth-groups] wrote', groupsPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

function saveMaterialsPlugin(): Plugin {
  return {
    name: 'save-materials',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/__dev/save-materials') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'POST only' }));
          return;
        }
        try {
          const raw = await readJsonBody(req);
          const payload = JSON.parse(raw) as SaveMaterialsPayload;
          const current = fs.readFileSync(materialsPath, 'utf8');
          const patched = applyMaterialPatches(current, payload);
          fs.writeFileSync(materialsPath, patched, 'utf8');
          console.log('[save-materials] wrote', materialsPath, payload);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, file: 'src/materials.ts' }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [redgradientPlugin(), saveMaterialsPlugin(), saveClothWeightsPlugin(), saveClothGroupsPlugin()],
  server: {
    // Keep material writes local-dev only; plugin is serve-only anyway.
    watch: {
      // Windows EBUSY when the IDE has a PNG open (palette strips).
      ignored: ['**/*.png'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.join(rootDir, 'index.html'),
        embed: path.join(rootDir, 'embed.html'),
      },
    },
  },
});
