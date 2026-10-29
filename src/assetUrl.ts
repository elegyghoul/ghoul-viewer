/** Set by the embed boot script before the viewer modules load. */
const g = globalThis as {
  __GHOUL_ASSET_BASE__?: string;
  __GHOUL_SHELL__?: ParentNode;
};

export type GhoulLaunch = {
  id?: number;
  scale: 'fit' | 'off';
  host: HTMLElement | null;
};

let launch: GhoulLaunch = { scale: 'off', host: null };

export function setAssetBase(base: string): void {
  g.__GHOUL_ASSET_BASE__ = base.endsWith('/') ? base : `${base}/`;
}

/**
 * Folder that holds public files in a production build.
 * The boot script is emitted under assets/, one level below those files.
 * A script placed directly in that folder (embed.js) uses its own directory.
 */
export function viewerPublicBase(moduleUrl: string): string {
  const url = new URL(moduleUrl);
  const marker = '/assets/';
  const at = url.pathname.lastIndexOf(marker);
  url.pathname =
    at === -1
      ? url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
      : url.pathname.slice(0, at + 1);
  url.search = '';
  url.hash = '';
  return url.href;
}

/** Public file URL. Root-absolute on the studio server, otherwise next to the built viewer. */
export function assetUrl(path: string): string {
  const rel = path.replace(/^\//, '');
  const base = g.__GHOUL_ASSET_BASE__;
  if (!base) return `/${rel}`;
  return new URL(rel, base).href;
}

export function setShellRoot(root: ParentNode): void {
  g.__GHOUL_SHELL__ = root;
}

/** Shadow root while embedding. The document for the studio page. */
export function shellRoot(): ParentNode {
  return g.__GHOUL_SHELL__ ?? document;
}

export function setLaunch(next: GhoulLaunch): void {
  launch = next;
}

export function ghoulLaunch(): GhoulLaunch {
  return launch;
}
