// Semantic identities copied from the reviewed baseline, commit
// 249a8fc86b5a293f82008b0db07c64aeca4ad2bd, feature root
// public/prototypes/bel-working-as-equals-demo/. Data only: no teaching text,
// no answer order hints, no side effects. tools/check-source-identity.mjs
// re-reads the baseline and fails if any value here drifts from it.

// activities/bridge.mjs PLANKS[index] = [color, mark, text, x, y].
// The plank text is deliberately NOT copied: it is disclosed by the
// application's screen-space label only when inspected/carried.
export const PLANK_IDENTITIES = Object.freeze([
  Object.freeze({ id: 'plank-0', index: 0, color: 'teal', mark: 'diamond' }),
  Object.freeze({ id: 'plank-1', index: 1, color: 'violet', mark: 'two bars' }),
  Object.freeze({ id: 'plank-2', index: 2, color: 'rose', mark: 'star' }),
  Object.freeze({ id: 'plank-3', index: 3, color: 'red', mark: 'circle' }),
  Object.freeze({ id: 'plank-4', index: 4, color: 'blue', mark: 'cross' }),
  Object.freeze({ id: 'plank-5', index: 5, color: 'amber', mark: 'triangle' })
]);

// ui/panels.mjs profile form options; state/session.mjs default
// appearance is { hat: 'none', glasses: false, shirt: 'default' }.
export const APPEARANCE_OPTIONS = Object.freeze({
  shirt: Object.freeze(['teal', 'cream', 'amber', 'red']),
  hat: Object.freeze(['none', 'straw', 'cap']),
  glasses: Object.freeze([false, true])
});
export const DEFAULT_APPEARANCE = Object.freeze({ hat: 'none', glasses: false, shirt: 'default' });

// Seats p0..p3: p0 is the presenter (gender 'male'); p1..p3 are participants
// ('female'), per state/session.mjs. Base looks follow the approved cast
// sprites (world/sprites.mjs createSpriteAtlas specs).
export const ACTORS = Object.freeze(['p0', 'p1', 'p2', 'p3']);

// Mirrors world/sprites.mjs: an unknown shirt value leaves the original
// clothing (no tint); only 'cap' and 'straw' draw a hat; glasses are truthy.
export function resolveAppearance(appearance = {}) {
  const shirt = APPEARANCE_OPTIONS.shirt.includes(appearance.shirt) ? appearance.shirt : 'default';
  const hat = appearance.hat === 'cap' || appearance.hat === 'straw' ? appearance.hat : 'none';
  return { shirt, hat, glasses: Boolean(appearance.glasses) };
}
