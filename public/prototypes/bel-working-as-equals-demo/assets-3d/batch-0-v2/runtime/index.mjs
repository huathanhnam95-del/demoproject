// BEL "Working as Equals" 3D asset pack — Batch 0 compatibility sample.
// Entry point of the THREE_MODULE pack. Importing this module has no side
// effects: it defines constants and functions only. The integration owner
// injects its pinned THREE namespace; the pack never imports 'three'.
import { createInstanceScope, createResourceCache } from './resources.mjs';
import { ACTORS, APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, PLANK_IDENTITIES } from './identity.mjs';
import { createAvatar } from './avatar.mjs';
import { createPlank } from './bridge-props.mjs';
import { createMeterReference } from './reference-meter.mjs';
import { createMaterialSamples } from './reference-materials.mjs';
import { CLIP_INFO } from './avatar-clips.mjs';

export const PACK = Object.freeze({
  id: 'bel-3d-claude',
  batch: 0,
  version: 'batch-0-v2',
  artDirection: 'BEL-ART-01 v1.0 (block-built, pixel-inspired)',
  supersedes: 'batch-0-v1 (rounded compatibility sample; kept for rollback)',
  representation: 'THREE_MODULE',
  three: Object.freeze({ version: '0.186.0', revision: '186' }),
  units: '1 world unit = 50 logical px (s = 0.02). X = (logical_x - 500) * s, Z = (logical_y - 240) * s, Y = visual height.',
  axes: '+Y up; +Z toward the viewer / larger logical y; an avatar faces +Z at rotation.y = 0; character-left = +X.'
});

// Declared interface delta against the previous pack version, for intake
// review (BEL-ART-01 section 11.1: version an unavoidable interface change).
export const INTERFACE_CHANGELOG = Object.freeze([
  Object.freeze({ version: 'batch-0-v2', change: 'socket_hat moved to [0, 0.33, 0] and socket_glasses to [0, 0.235, 0.172] in J_head space, because the head is now a cuboid', impact: 'avatar-internal; hats and glasses are owned by the avatar, so no integration code changes' }),
  Object.freeze({ version: 'batch-0-v2', change: 'new preview-only asset id ref.material-samples', impact: 'additive; never placed in the game' }),
  Object.freeze({ version: 'batch-0-v2', change: 'avatar and plank geometry rebuilt as chamfered cuboids; plank body and shoe materials now use vertexColors', impact: 'visual only: pivots, units, facing, bounds envelope, clips, bindings, asset ids and appearance semantics unchanged' })
]);

export const ASSET_CATALOG = Object.freeze([
  Object.freeze({ assetId: 'avatar.participant', role: 'batch-0-compatibility-sample', variant: '{ actor: p0|p1|p2|p3, appearance?: { shirt, hat, glasses } }',
    actors: ACTORS, appearance: APPEARANCE_OPTIONS, defaultAppearance: DEFAULT_APPEARANCE, clips: Object.keys(CLIP_INFO) }),
  Object.freeze({ assetId: 'prop.bridge-plank', role: 'batch-0-compatibility-sample', variant: 'plank-0 … plank-5', variants: PLANK_IDENTITIES.map(p => p.id) }),
  Object.freeze({ assetId: 'ref.meter', role: 'preview-reference', variant: 'none' }),
  Object.freeze({ assetId: 'ref.material-samples', role: 'preview-reference', variant: 'none' })
]);

const FACTORIES = { 'avatar.participant': createAvatar, 'prop.bridge-plank': createPlank, 'ref.meter': createMeterReference, 'ref.material-samples': createMaterialSamples };

export { createResourceCache };

/**
 * createAsset({ THREE, assetId, variant, seed, resources })
 *   -> { root, clips, sockets, bounds, applyAppearance, dispose, metadata, ... }
 * THREE      the application's pinned three@0.186.0 namespace (required)
 * resources  optional createResourceCache(THREE); shared immutable resources
 *            are reference-counted there. Without it the asset owns a private cache.
 * seed       recorded only: Batch 0 construction has no cosmetic randomness.
 * dispose()  idempotent; detaches root, disposes owned resources and releases
 *            shared ones. Never touches resources other live instances hold.
 */
export function createAsset({ THREE, assetId, variant, seed = 0, resources } = {}) {
  if (!THREE || typeof THREE.Object3D !== 'function') throw new TypeError('createAsset requires the injected THREE namespace.');
  if (THREE.REVISION !== PACK.three.revision) throw new Error(`This pack is pinned to three ${PACK.three.version} (r${PACK.three.revision}); received r${THREE.REVISION}.`);
  const factory = FACTORIES[assetId];
  if (!factory) throw new RangeError(`Unknown assetId "${assetId}". Known: ${Object.keys(FACTORIES).join(', ')}.`);
  const scope = createInstanceScope(THREE, resources);
  let asset;
  try {
    asset = factory(THREE, scope, { variant, assetId, packVersion: PACK.version });
  } catch (error) {
    scope.dispose();
    throw error;
  }
  const { root } = asset;
  Object.assign(asset, { assetId, variant, seed });
  Object.defineProperty(asset, 'disposed', { get: () => scope.disposed, enumerable: true });
  asset.dispose = () => {
    if (scope.disposed) return false;
    root.removeFromParent();
    return scope.dispose();
  };
  return asset;
}
