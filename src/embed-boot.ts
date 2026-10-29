import shellHtml from './shell.html?raw';
import cssUrl from '../ghoul-viewer.css?url';
import { assetUrl, setAssetBase, setLaunch, setShellRoot } from './assetUrl';

function thisScript(): HTMLScriptElement | null {
  const me = import.meta.url;
  for (const script of document.scripts) {
    if (script.src === me) return script;
  }
  return document.querySelector('script[data-target]');
}

function boot(): void {
  const base = import.meta.env.DEV
    ? new URL('/', window.location.origin).href
    : new URL('.', import.meta.url).href;
  setAssetBase(base);

  const script = thisScript();
  const targetSel = script?.dataset.target;
  // Vite's production build deletes the demo page's script tag and injects a
  // new one, so data-target is gone. The div keeps data-ghoul-viewer.
  const marked = document.querySelector('[data-ghoul-viewer]');
  let host: HTMLElement | null = null;
  if (targetSel) {
    const found = document.querySelector(targetSel);
    if (!(found instanceof HTMLElement)) {
      console.error('[ghoul-viewer] data-target not found:', targetSel);
      return;
    }
    host = found;
  } else if (marked instanceof HTMLElement) {
    host = marked;
  } else {
    console.error('[ghoul-viewer] script is missing data-target');
    return;
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL(cssUrl, import.meta.url).href;

  const markup = shellHtml.replace(
    /(src=")(\/[^"]+)(")/g,
    (_match, open: string, path: string, close: string) => open + assetUrl(path) + close,
  );
  const holder = document.createElement('template');
  holder.innerHTML = markup;
  const options = targetSel ? script : host;
  const ghoulAttr = options?.dataset.ghoul;
  const id = ghoulAttr != null && ghoulAttr !== '' ? Number(ghoulAttr) : undefined;
  setShellRoot(shadow);
  setLaunch({
    id: id != null && Number.isFinite(id) ? id : undefined,
    scale: options?.dataset.scale === 'fit' ? 'fit' : 'off',
    host,
  });

  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    void import('./embed.ts');
  };
  link.addEventListener('load', start, { once: true });
  link.addEventListener('error', start, { once: true });
  shadow.append(link, holder.content);
  if (link.sheet) start();
}

boot();
