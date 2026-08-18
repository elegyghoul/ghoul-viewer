import type { GhoulTraits, TraitRules } from './types';
import { GhoulAssembler } from './assembleGhoul';

let traitsList: GhoulTraits[] | null = null;
let traitsById: Map<number, GhoulTraits> | null = null;
let rules: TraitRules | null = null;

export async function loadTraitData(): Promise<void> {
  const [traitsRes, rulesRes] = await Promise.all([
    fetch('/data/traits.json'),
    fetch('/data/trait-rules.json'),
  ]);
  if (!traitsRes.ok) throw new Error('traits.json missing');
  if (!rulesRes.ok) throw new Error('trait-rules.json missing');
  traitsList = (await traitsRes.json()) as GhoulTraits[];
  rules = (await rulesRes.json()) as TraitRules;
  traitsById = new Map(traitsList.map((t) => [t.id, t]));
}

export function getTraits(id: number): GhoulTraits | undefined {
  return traitsById?.get(id);
}

export async function createAssembler(): Promise<GhoulAssembler> {
  if (!rules) await loadTraitData();
  const assembler = new GhoulAssembler();
  await assembler.init(null, rules!);
  return assembler;
}

export function loadGhoul(assembler: GhoulAssembler, number: number): GhoulTraits {
  if (number < 0 || number > 6666) {
    throw new Error(`Ghoul number must be 0–6666, got ${number}`);
  }
  const traits = getTraits(number);
  if (!traits) {
    throw new Error(`No trait data for ghoul #${number}`);
  }
  assembler.assemble(traits);
  return traits;
}
