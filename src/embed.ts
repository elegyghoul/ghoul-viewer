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
  lighting: 'Lighting',
  bloom: 'Effects',
};

const TOOL_PANES: Record<string, string> = {
  scene: 'sceneControls',
  camera: 'cameraControls',
  lighting: 'brightnessControls',
  bloom: 'bloomControls',
};

function bindToolTabs(): void {
  const title = document.getElementById('ghoul-tool-title');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.ghoul-tool-tab')];
  const show = (panel: string): void => {
    if (title) title.textContent = TOOL_TITLES[panel] ?? panel;
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', tab.dataset.panel === panel ? 'true' : 'false');
    }
    for (const [key, id] of Object.entries(TOOL_PANES)) {
      const pane = document.getElementById(id);
      if (pane) pane.hidden = key !== panel;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab.dataset.panel ?? 'camera'));
  }
}

const slot = document.getElementById('ghoul-slot');
if (slot) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id');
  const startId = raw != null && raw !== '' ? Number(raw) : 0;
  const header = document.getElementById('ghoul-window-title');
  const setHeader = (id: number): void => {
    if (header) header.textContent = headerLabel(id);
  };
  setHeader(startId);
  bindToolTabs();
  document.querySelector('.ghoul-stage')?.addEventListener('pointerup', () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return;
    if (el instanceof HTMLInputElement) return;
    if (el.closest('.ghoul-controls, .ghoul-mode-tabs, .ghoul-tool-tabs, .ghoul-id-picker')) {
      el.blur();
    }
  });
  mountGhoulViewer(slot, {
    id: startId,
    updateUrl: false,
    onLoad: setHeader,
  });
}
