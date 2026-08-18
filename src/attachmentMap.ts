import type { AttachmentMap, AttachmentPart } from './types';

let cached: AttachmentMap | null = null;

export async function loadAttachmentMap(): Promise<AttachmentMap> {
  if (cached) return cached;
  const res = await fetch('/data/attachment-map.json');
  if (!res.ok) throw new Error(`Failed to load attachment-map.json: ${res.status}`);
  cached = (await res.json()) as AttachmentMap;
  return cached;
}

export function getPart(map: AttachmentMap, id: string): AttachmentPart | undefined {
  return map.parts.find((p) => p.id === id);
}
