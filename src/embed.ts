import {
  mountGhoulViewer,
  type AppMode,
  type BallLevels,
  type BallPatch,
  type BgMode,
  type BloomLevels,
  type FogLevels,
  type FogPatch,
  type GhoulViewer,
  type GhoulViewerOptions,
  type ViewLevels,
  type ViewPatch,
} from './main';
import type { BloomMode } from './dither';
import type { PlayCameraMode } from './playMode';
import fontUrl from './assets/BMAS_Pixel_Console.otf?url';
import { ghoulLaunch, shellRoot } from './assetUrl';

export {
  mountGhoulViewer,
  type AppMode,
  type BallLevels,
  type BallPatch,
  type BgMode,
  type BloomLevels,
  type FogLevels,
  type FogPatch,
  type GhoulViewer,
  type GhoulViewerOptions,
  type ViewLevels,
  type ViewPatch,
};
export type { BloomMode };

function optionsFromElement(el: HTMLElement): GhoulViewerOptions {
  const ghoul = el.getAttribute('ghoul');
  const mode = el.getAttribute('mode') as AppMode | null;
  const camera = el.getAttribute('camera') as PlayCameraMode | null;
  const background = el.getAttribute('background') as BgMode | null;
  return {
    id: ghoul != null && ghoul !== '' ? Number(ghoul) : undefined,
    mode: mode === 'view' || mode === 'play' ? mode : undefined,
    camera: camera === 'fixed' || camera === 'follow' ? camera : undefined,
    background:
      background === 'grid' || background === 'trait' || background === 'ghoulball'
        ? background
        : undefined,
  };
}

export class GhoulViewerElement extends HTMLElement {
  api: GhoulViewer | null = null;

  connectedCallback(): void {
    if (this.api) return;
    this.api = mountGhoulViewer(this, optionsFromElement(this));
    this.load = (id: number) => this.api!.load(id);
    this.setLights = (levels) => this.api!.setLights(levels);
    this.getLights = () => this.api!.getLights();
    this.resetLights = () => this.api!.resetLights();
    this.setView = (levels) => this.api!.setView(levels);
    this.getView = () => this.api!.getView();
    this.resetView = () => this.api!.resetView();
    this.setBloom = (levels) => this.api!.setBloom(levels);
    this.getBloom = () => this.api!.getBloom();
    this.resetBloom = () => this.api!.resetBloom();
    this.setFog = (levels) => this.api!.setFog(levels);
    this.getFog = () => this.api!.getFog();
    this.resetFog = () => this.api!.resetFog();
    this.setBall = (levels) => this.api!.setBall(levels);
    this.getBall = () => this.api!.getBall();
    this.resetBall = () => this.api!.resetBall();
    this.setMode = (mode) => this.api!.setMode(mode);
    this.getMode = () => this.api!.getMode();
    this.setCamera = (mode) => this.api!.setCamera(mode);
    this.getCamera = () => this.api!.getCamera();
    this.setFollow = (levels) => this.api!.setFollow(levels);
    this.getFollow = () => this.api!.getFollow();
    this.resetFollow = () => this.api!.resetFollow();
    this.setBackground = (mode) => this.api!.setBackground(mode);
    this.getBackground = () => this.api!.getBackground();
    this.setAnim = (name) => this.api!.setAnim(name);
    this.getAnim = () => this.api!.getAnim();
    this.reset = () => this.api!.reset();
    this.getId = () => this.api!.getId();
  }

  load!: GhoulViewer['load'];
  getId!: GhoulViewer['getId'];
  setLights!: GhoulViewer['setLights'];
  getLights!: GhoulViewer['getLights'];
  resetLights!: GhoulViewer['resetLights'];
  setView!: GhoulViewer['setView'];
  getView!: GhoulViewer['getView'];
  resetView!: GhoulViewer['resetView'];
  setBloom!: GhoulViewer['setBloom'];
  getBloom!: GhoulViewer['getBloom'];
  resetBloom!: GhoulViewer['resetBloom'];
  setFog!: GhoulViewer['setFog'];
  getFog!: GhoulViewer['getFog'];
  resetFog!: GhoulViewer['resetFog'];
  setBall!: GhoulViewer['setBall'];
  getBall!: GhoulViewer['getBall'];
  resetBall!: GhoulViewer['resetBall'];
  setMode!: GhoulViewer['setMode'];
  getMode!: GhoulViewer['getMode'];
  setCamera!: GhoulViewer['setCamera'];
  getCamera!: GhoulViewer['getCamera'];
  setFollow!: GhoulViewer['setFollow'];
  getFollow!: GhoulViewer['getFollow'];
  resetFollow!: GhoulViewer['resetFollow'];
  setBackground!: GhoulViewer['setBackground'];
  getBackground!: GhoulViewer['getBackground'];
  setAnim!: GhoulViewer['setAnim'];
  getAnim!: GhoulViewer['getAnim'];
  reset!: GhoulViewer['reset'];
}

if (!customElements.get('ghoul-viewer')) {
  customElements.define('ghoul-viewer', GhoulViewerElement);
}

const fontFace = new FontFace('BMAS Pixel Console', `url(${fontUrl})`);
void fontFace.load().then((face) => {
  document.fonts.add(face);
});

function headerLabel(id: number): string {
  return `Ghoul Viewer - #${id}`;
}

const TOOL_TITLES: Record<string, string> = {
  scene: 'Scene',
  camera: 'Camera',
  anim: 'Animation',
  lighting: 'Lighting',
  bloom: 'Effects',
};

const TOOL_PANES: Record<string, string> = {
  scene: 'sceneControls',
  camera: 'cameraControls',
  anim: 'animControls',
  lighting: 'brightnessControls',
  bloom: 'bloomControls',
};

function shellEl<T extends HTMLElement>(id: string): T | null {
  return shellRoot().querySelector<T>('#' + CSS.escape(id));
}

function focusedInShell(): Element | null {
  const root = shellRoot();
  if (root instanceof ShadowRoot) return root.activeElement;
  return document.activeElement;
}

function bindScaleFit(host: HTMLElement): void {
  const stage = shellRoot().querySelector<HTMLElement>('.ghoul-stage-scale');
  if (!stage) return;
  const apply = (): void => {
    stage.style.setProperty('--gv-scale', '1');
    stage.classList.remove('is-scaled');
    const nativeW = stage.offsetWidth;
    const nativeH = stage.offsetHeight;
    if (nativeW < 1 || nativeH < 1) return;
    const scale = Math.min(host.clientWidth / nativeW, host.clientHeight / nativeH);
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.001) {
      stage.style.removeProperty('--gv-scale');
      return;
    }
    stage.style.setProperty('--gv-scale', String(scale));
    stage.classList.add('is-scaled');
  };
  apply();
  new ResizeObserver(apply).observe(host);
}

function bindToolTabs(): void {
  const title = shellEl<HTMLElement>('ghoul-tool-title');
  const tabs = [...shellRoot().querySelectorAll<HTMLButtonElement>('.ghoul-tool-tab')];
  const show = (panel: string): void => {
    if (title) title.textContent = TOOL_TITLES[panel] ?? panel;
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', tab.dataset.panel === panel ? 'true' : 'false');
    }
    for (const [key, id] of Object.entries(TOOL_PANES)) {
      const pane = shellEl<HTMLElement>(id);
      if (pane) pane.hidden = key !== panel;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab.dataset.panel ?? 'camera'));
  }
}

/** Prefer `?id=15` / `?15` / `?=15`, then data-ghoul. */
function startingId(): number {
  const params = new URLSearchParams(window.location.search);
  const named = params.get('id');
  if (named != null && named !== '') return Number(named);
  const emptyKey = params.get('');
  if (emptyKey != null && emptyKey !== '') return Number(emptyKey);
  const bare = [...params.keys()].find((k) => k !== '');
  if (bare != null) return Number(bare);
  const launched = ghoulLaunch().id;
  if (launched != null && Number.isFinite(launched)) return launched;
  return 0;
}

const slot = shellEl<HTMLElement>('ghoul-slot');
if (slot) {
  const startId = startingId();
  const header = shellEl<HTMLElement>('ghoul-window-title');
  const setHeader = (id: number): void => {
    if (header) header.textContent = headerLabel(id);
  };
  setHeader(startId);
  bindToolTabs();
  const launch = ghoulLaunch();
  const idPicker = !!launch.host?.hasAttribute('data-id-picker');
  if (launch.scale === 'fit' && launch.host) bindScaleFit(launch.host);
  shellRoot().querySelector('.ghoul-stage')?.addEventListener('pointerup', () => {
    const el = focusedInShell();
    if (!(el instanceof HTMLElement)) return;
    if (el instanceof HTMLInputElement) return;
    if (el.closest('.ghoul-controls, .ghoul-mode-tabs, .ghoul-tool-tabs, .ghoul-id-picker')) {
      el.blur();
    }
  });
  const viewer = mountGhoulViewer(slot, {
    id: startId,
    // Keep the address bar shareable on id-picker demo pages (e.g. embedScaled).
    updateUrl: idPicker,
    onLoad: setHeader,
  });
  if (launch.host) (launch.host as HTMLElement & { viewer: GhoulViewer }).viewer = viewer;
}
