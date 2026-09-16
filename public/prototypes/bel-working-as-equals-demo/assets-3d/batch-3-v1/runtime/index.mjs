// BEL "Working as Equals" 3D asset pack — Batch 3 (final asset batch).
// Entry point of the THREE_MODULE pack. Importing this module has no side
// effects: it defines constants and functions only. The integration owner
// injects its pinned THREE namespace; the pack never imports 'three'.
import { createInstanceScope, createResourceCache } from './resources.mjs';
import { ACTORS, APPEARANCE_OPTIONS, CAR_VARIANTS, DEFAULT_APPEARANCE, PLANK_IDENTITIES, RIDE_IDENTITIES } from './identity.mjs';
import { createAvatar } from './avatar.mjs';
import { createPlank } from './bridge-props.mjs';
import { createMeterReference } from './reference-meter.mjs';
import { createMaterialSamples } from './reference-materials.mjs';
import { ROOM_COMPONENT_IDS, createRoomComponent } from './room-kit.mjs';
import { STUDIO_COMPONENT_IDS, createStudioComponent } from './studio-kit.mjs';
import { createDustMotes, createSunPatch } from './fx.mjs';
import { ACTIVITY_COMPONENT_IDS, createActivityProp } from './activity-props.mjs';
import { HOME_STREET_COMPONENT_IDS, createHomeStreetComponent } from './home-street-kit.mjs';
import { LIGHTING_REFERENCE, DEFAULT_PRESET } from './lighting.mjs';
import { CLIP_INFO } from './avatar-clips.mjs';

export const PACK = Object.freeze({
  id: 'bel-3d-claude',
  batch: 3,
  version: 'batch-3-v1',
  artDirection: 'BEL-ART-01 v1.0 (block-built, pixel-inspired)',
  supersedes: 'batch-2-v1 (poses + activity props; kept for rollback)',
  representation: 'THREE_MODULE',
  three: Object.freeze({ version: '0.186.0', revision: '186' }),
  units: '1 world unit = 50 logical px (s = 0.02). X = (logical_x - 500) * s, Z = (logical_y - 240) * s, Y = visual height.',
  axes: '+Y up; +Z toward the viewer / larger logical y; an avatar faces +Z at rotation.y = 0; character-left = +X.'
});

// Declared interface delta against the previous pack version, for intake
// review (BEL-ART-01 section 11.1: version an unavoidable interface change).
export const INTERFACE_CHANGELOG = Object.freeze([
  Object.freeze({ version: 'batch-3-v1', change: 'added nine clips (Wave, HandholdIdle_L/R, HandholdWalk_L/R, ScooterIdle/Ride, SkateboardIdle/Ride) and the Home / Street / Reception kit (15 ids)', impact: 'additive: no existing id, pivot, socket, clip, bound or appearance rule changed. Wave is the first clip with loop = false, so a caller must read CLIP_INFO[name].loop instead of assuming LoopRepeat.' }),
  Object.freeze({ version: 'batch-2-v1', change: 'Batch 1 completed with the CarryIdle, CarryWalk and SeatedIdle clips; studio.chair seat height fitted to SeatedIdle (0.42 -> 0.36); added the Batch 2 activity props (6 ids)', impact: 'additive for asset ids; the three new clips join the existing two on the same rig and bindings; the chair seat height is a visual dimension the caller can still override' }),
  Object.freeze({ version: 'batch-1-v1', change: 'added the room kit (7 ids), studio kit (4 ids) and two optional atmosphere ids; added LIGHTING_REFERENCE as exported data', impact: 'additive only: no existing id, pivot, socket, clip or appearance rule changed' }),
  Object.freeze({ version: 'batch-0-v2', change: 'socket_hat moved to [0, 0.33, 0] and socket_glasses to [0, 0.235, 0.172] in J_head space, because the head is now a cuboid', impact: 'avatar-internal; hats and glasses are owned by the avatar, so no integration code changes' }),
  Object.freeze({ version: 'batch-0-v2', change: 'new preview-only asset id ref.material-samples', impact: 'additive; never placed in the game' }),
  Object.freeze({ version: 'batch-0-v2', change: 'avatar and plank geometry rebuilt as chamfered cuboids; plank body and shoe materials now use vertexColors', impact: 'visual only: pivots, units, facing, bounds envelope, clips, bindings, asset ids and appearance semantics unchanged' })
]);

export const ASSET_CATALOG = Object.freeze([
  Object.freeze({ assetId: 'avatar.participant', role: 'batch-0-compatibility-sample', variant: '{ actor: p0|p1|p2|p3, appearance?: { shirt, hat, glasses } }',
    actors: ACTORS, appearance: APPEARANCE_OPTIONS, defaultAppearance: DEFAULT_APPEARANCE, clips: Object.keys(CLIP_INFO) }),
  Object.freeze({ assetId: 'prop.bridge-plank', role: 'batch-0-compatibility-sample', variant: 'plank-0 … plank-5', variants: PLANK_IDENTITIES.map(p => p.id) }),
  ...ROOM_COMPONENT_IDS.map(id => Object.freeze({ assetId: id, role: 'room kit (Room F / studios)', variant: 'sized by the caller from the baseline logical rectangles' })),
  ...STUDIO_COMPONENT_IDS.map(id => Object.freeze({ assetId: id, role: 'studio kit (A/C/E/G)', variant: 'sized by the caller from the baseline logical rectangles' })),
  ...ACTIVITY_COMPONENT_IDS.map(id => Object.freeze({ assetId: id, role: 'activity props (B routes, Gallery D, Room I, Room J)', variant: 'identity id or size, from the baseline activity data' })),
  ...HOME_STREET_COMPONENT_IDS.map(id => Object.freeze({ assetId: id, role: 'Home / Street / Reception kit',
    variant: id === 'prop.car' ? `car-0 | car-1 (${CAR_VARIANTS.map(c => c.color).join(', ')})` : (id === 'prop.scooter' || id === 'prop.skateboard' ? '{ stand?: boolean }' : 'sized by the caller from the baseline logical rectangles') })),
  Object.freeze({ assetId: 'fx.sun-patch', role: 'optional atmosphere (off by default)', variant: '{ width, depth, skew }' }),
  Object.freeze({ assetId: 'fx.dust-motes', role: 'optional atmosphere (off by default, reduced-motion aware)', variant: '{ clusters, motesPerCluster, size, volume }' }),
  Object.freeze({ assetId: 'ref.meter', role: 'preview-reference', variant: 'none' }),
  Object.freeze({ assetId: 'ref.material-samples', role: 'preview-reference', variant: 'none' })
]);

const KIT_FACTORIES = Object.fromEntries([
  ...ROOM_COMPONENT_IDS.map(id => [id, (THREE, scope, options) => createRoomComponent(THREE, scope, options)]),
  ...ACTIVITY_COMPONENT_IDS.map(id => [id, (THREE, scope, options) => createActivityProp(THREE, scope, options)]),
  ...STUDIO_COMPONENT_IDS.map(id => [id, (THREE, scope, options) => createStudioComponent(THREE, scope, options)]),
  ...HOME_STREET_COMPONENT_IDS.map(id => [id, (THREE, scope, options) => createHomeStreetComponent(THREE, scope, options)])
]);
const FACTORIES = {
  'avatar.participant': createAvatar, 'prop.bridge-plank': createPlank,
  ...KIT_FACTORIES,
  'fx.sun-patch': createSunPatch, 'fx.dust-motes': createDustMotes,
  'ref.meter': createMeterReference, 'ref.material-samples': createMaterialSamples
};

export { createResourceCache, LIGHTING_REFERENCE, DEFAULT_PRESET, RIDE_IDENTITIES, CAR_VARIANTS };

/**
 * createAsset({ THREE, assetId, variant, seed, resources })
 *   -> { root, clips, sockets, bounds, applyAppearance, dispose, metadata, ... }
 * THREE      the application's pinned three@0.186.0 namespace (required)
 * resources  optional createResourceCache(THREE); shared immutable resources
 *            are reference-counted there. Without it the asset owns a private cache.
 * seed       recorded only: construction is deterministic, with no cosmetic randomness.
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
    asset = factory(THREE, scope, { variant, seed, assetId, packVersion: PACK.version });
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
