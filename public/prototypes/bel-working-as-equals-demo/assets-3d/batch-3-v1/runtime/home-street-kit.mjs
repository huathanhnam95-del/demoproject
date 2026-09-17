// Batch 3 kit — Home, the Street and Reception, block-built (BEL-ART-01).
//
// Only objects the baseline already has: the two ridable objects that live in
// Home (world/simulation.mjs), the wardrobe / bookcase / side table painted in
// home.png, the reception counter, cabinet and waiting bench, and the street's
// building frontage, road, crossing, traffic, house and bench.
//
// Sizes come from the baseline logical rectangles where a rectangle exists.
// A tall object's logical solid covers both its footprint and its painted
// height in the 2D projection, so the caller passes `depth` and `height`
// separately; those two are authored and every assembly entry says so.
//
// Nothing here carries a word, a sign legend, a number or a route hint. The
// reception and facade boards are modelled as blank panels: any lettering
// stays with the host, exactly as the monitor surfaces do.
import { CAR_VARIANTS, RIDE_IDENTITIES } from './identity.mjs';
import { RIDE_PROFILES } from './avatar-rig.mjs';
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, mergeGeometries, tint, verticalTint } from './geometry.mjs';

const at = (x, y, z) => ({ position: [x, y, z] });
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const S = 0.02;

// Authored defaults for the pieces whose height cannot be read off a logical
// rectangle. Every one of them is overridable by the caller.
export const HOME_STREET_DEFAULTS = Object.freeze({
  wardrobe: Object.freeze({ width: 1.16, depth: 0.62, height: 2.0 }),
  bookcase: Object.freeze({ width: 3.42, depth: 0.56, height: 1.9, shelves: 4 }),
  sideTable: Object.freeze({ width: 0.8, depth: 0.88, height: 0.62 }),
  counter: Object.freeze({ width: 1.74, depth: 2.74, height: 1.06 }),
  waitingBench: Object.freeze({ width: 1.34, depth: 2.36, seatHeight: 0.42, seats: 3 }),
  signBoard: Object.freeze({ width: 2.9, height: 1.1 }),
  building: Object.freeze({ height: 3.4, depth: 0.9 }),
  house: Object.freeze({ width: 3.22, depth: 2.14, height: 2.2 }),
  hedge: Object.freeze({ height: 0.62, depth: 0.5 }),
  carHeight: 0.86,
  roadKerb: 0.13
});

// Deck geometry shared by both rides, from world/sprites.mjs ride():
// a 56 px deck with its axles 23 px either side of centre, and a rider lifted
// 6 px, which is the standing height in RIDE_PROFILES.
const DECK = Object.freeze({ length: 1.12, gripLength: 0.92, wheelRadius: 0.045, axleZ: 0.46 });

function rideGeometry(THREE, kind, width) {
  const p = RIDE_PROFILES[kind], top = p.standHeight, parts = [];
  parts.push(tint(THREE, block(THREE, width, 0.018, DECK.length, at(0, top - 0.009, 0), 0.006), 1));               // deck body top
  parts.push(tint(THREE, block(THREE, width - 0.03, 0.022, DECK.length - 0.06, at(0, top - 0.03, 0), 0.006), 0.82)); // deck underside
  return { parts, top, p };
}

const COMPONENTS = {
  // ---- the two ridable objects (Home) ----
  'prop.scooter': (THREE, scope, variant) => {
    const width = num(variant.width, 0.22), { parts, top } = rideGeometry(THREE, 'scooter', width);
    const deckGeo = scope.shared(`geometry:ride:scooterDeck:${width}`, () => mergeGeometries(THREE, [
      ...parts,
      tint(THREE, block(THREE, width * 0.9, 0.86, 0.06, at(0, top + 0.43, 0.4), 0.008), 0.9)            // stem, 43 px tall at the front axle end
    ]));
    const deck = new THREE.Mesh(deckGeo, sharedMaterial(THREE, scope, 'rideDeck', PALETTE.ride.deck, { ...SURFACE.paintedWood, vertexColors: true }));
    deck.name = 'M_scooter_deck'; deck.castShadow = true;
    const gripGeo = scope.shared(`geometry:ride:scooterGrip:${width}`, () => block(THREE, width - 0.02, 0.012, DECK.gripLength, at(0, top - 0.006, 0), 0));
    const grip = new THREE.Mesh(gripGeo, sharedMaterial(THREE, scope, 'scooterGrip', PALETTE.ride.gripScooter, SURFACE.rubber));
    grip.name = 'M_scooter_grip';
    const barGeo = scope.shared('geometry:ride:scooterBar', () => mergeGeometries(THREE, [
      block(THREE, 0.44, 0.05, 0.05, at(0, 0.98, 0.4), 0.008),
      tint(THREE, block(THREE, 0.02, 0.64, 0.02, at(0, 0.64, 0.43), 0), 1.6)                            // the polished stem highlight
    ]));
    const bar = new THREE.Mesh(barGeo, sharedMaterial(THREE, scope, 'scooterBar', PALETTE.ride.handlebar, { ...SURFACE.frame, vertexColors: true }));
    bar.name = 'M_scooter_handlebar'; bar.castShadow = true;
    const meshes = [deck, grip, bar, ...wheelMeshes(THREE, scope, width, 2)];
    if (variant.stand) meshes.push(standMesh(THREE, scope));
    return {
      meshes,
      sockets: { socket_rider: [0, RIDE_PROFILES.scooter.standHeight, 0], socket_grip: RIDE_PROFILES.scooter.grip.slice() },
      info: { kind: 'scooter', deckLength: DECK.length, standHeight: RIDE_PROFILES.scooter.standHeight, grip: RIDE_PROFILES.scooter.grip,
        note: 'Colours are the world/sprites.mjs ride() constants; the deck length, axle spacing and stem height are its rectangles x 0.02.' }
    };
  },
  'prop.skateboard': (THREE, scope, variant) => {
    const width = num(variant.width, 0.26), { parts, top } = rideGeometry(THREE, 'skateboard', width);
    const deckGeo = scope.shared(`geometry:ride:boardDeck:${width}`, () => mergeGeometries(THREE, parts));
    const deck = new THREE.Mesh(deckGeo, sharedMaterial(THREE, scope, 'rideDeck', PALETTE.ride.deck, { ...SURFACE.paintedWood, vertexColors: true }));
    deck.name = 'M_skateboard_deck'; deck.castShadow = true;
    const gripGeo = scope.shared(`geometry:ride:boardGrip:${width}`, () => block(THREE, width - 0.02, 0.012, DECK.gripLength, at(0, top - 0.006, 0), 0));
    const grip = new THREE.Mesh(gripGeo, sharedMaterial(THREE, scope, 'boardGrip', PALETTE.ride.gripBoard, SURFACE.rubber));
    grip.name = 'M_skateboard_grip';
    // ride() draws a 6 px kick at each end; here they are the raised nose and tail.
    const kickGeo = scope.shared(`geometry:ride:boardKicks:${width}`, () => mergeGeometries(THREE, [-1, 1].map(s =>
      block(THREE, width - 0.02, 0.016, 0.12, at(0, top + 0.012, s * (DECK.length / 2 - 0.05)), 0.006))));
    const kicks = new THREE.Mesh(kickGeo, sharedMaterial(THREE, scope, 'boardKick', PALETTE.ride.kick, SURFACE.paintedWood));
    kicks.name = 'M_skateboard_kicks';
    const meshes = [deck, grip, kicks, ...wheelMeshes(THREE, scope, width, 4)];
    if (variant.stand) meshes.push(standMesh(THREE, scope));
    return {
      meshes,
      sockets: { socket_rider: [0, RIDE_PROFILES.skateboard.standHeight, 0] },
      info: { kind: 'skateboard', deckLength: DECK.length, standHeight: RIDE_PROFILES.skateboard.standHeight, grip: null,
        note: 'Colours are the world/sprites.mjs ride() constants; the deck length and axle spacing are its rectangles x 0.02.' }
    };
  },

  // ---- Home furniture ----
  'prop.wardrobe': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.wardrobe;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth), height = num(variant.height, d.height);
    const bodyGeo = scope.shared(`geometry:home:wardrobe:${width}x${depth}x${height}`, () => {
      const parts = [verticalTint(THREE, block(THREE, width, height - 0.06, depth, at(0, (height - 0.06) / 2 + 0.06, 0)), 0, height, 0.78, 1.0)];
      parts.push(tint(THREE, block(THREE, width + 0.05, 0.06, depth + 0.05, at(0, height - 0.03, 0), 0.008), 1.12));   // lit cornice
      parts.push(tint(THREE, block(THREE, width + 0.03, 0.06, depth + 0.03, at(0, 0.03, 0), 0.008), 0.72));            // plinth
      parts.push(tint(THREE, block(THREE, 0.02, height - 0.3, 0.02, at(0, height / 2, depth / 2 + 0.005), 0), 1.2));   // the seam between the two doors
      return mergeGeometries(THREE, parts);
    });
    const body = new THREE.Mesh(bodyGeo, sharedMaterial(THREE, scope, 'wardrobeWood', PALETTE.home.wardrobeFront, { ...SURFACE.timber, vertexColors: true }));
    body.name = 'M_wardrobe_body'; body.castShadow = true; body.receiveShadow = true;
    const handleGeo = scope.shared('geometry:home:wardrobeHandles', () => mergeGeometries(THREE, [-1, 1].map(s =>
      block(THREE, 0.025, 0.24, 0.025, at(s * 0.07, 1.0, 0)))));
    const handles = new THREE.Mesh(handleGeo, sharedMaterial(THREE, scope, 'metalHandle', PALETTE.ride.hub, SURFACE.frame));
    handles.name = 'M_wardrobe_handles'; handles.position.z = depth / 2 + 0.01;
    return { meshes: [body, handles], sockets: {}, info: { width, depth, height, note: 'The logical solid is 58 x 151 px: its width is the source value, while depth and height are the authored split of the painted silhouette.' } };
  },
  'prop.bookcase': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.bookcase;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth), height = num(variant.height, d.height);
    const shelves = Math.max(2, Math.round(num(variant.shelves, d.shelves)));
    const frameGeo = scope.shared(`geometry:home:bookcase:${width}x${depth}x${height}:${shelves}`, () => {
      const parts = [], t = 0.07;
      parts.push(tint(THREE, block(THREE, width, t, depth, at(0, height - t / 2, 0), 0.008), 1.1));            // top
      parts.push(tint(THREE, block(THREE, width, t, depth, at(0, t / 2, 0), 0.008), 0.8));                     // base
      for (const s of [-1, 1]) parts.push(block(THREE, t, height, depth, at(s * (width - t) / 2, height / 2, 0), 0.008));
      parts.push(tint(THREE, block(THREE, width - 2 * t, height - 2 * t, 0.05, at(0, height / 2, -depth / 2 + 0.025), 0.006), 0.66)); // back panel
      const columns = Math.max(2, Math.round(width / 1.2));
      for (let i = 1; i < columns; i++) parts.push(block(THREE, t * 0.7, height - 2 * t, depth - 0.06, at(-width / 2 + (width * i) / columns, height / 2, 0.02), 0.006));
      for (let i = 1; i < shelves; i++) parts.push(tint(THREE, block(THREE, width - 2 * t, 0.05, depth - 0.05, at(0, (height * i) / shelves, 0.01), 0.006), 0.94));
      return mergeGeometries(THREE, parts);
    });
    const frame = new THREE.Mesh(frameGeo, sharedMaterial(THREE, scope, 'bookcaseWood', PALETTE.home.bookcaseFrame, { ...SURFACE.timber, vertexColors: true }));
    frame.name = 'M_bookcase_frame'; frame.castShadow = true; frame.receiveShadow = true;
    // Spines: plain coloured blocks in the sampled spine colours. No lettering.
    const spines = PALETTE.home.bookSpines.map((hex, index) => {
      const geo = scope.shared(`geometry:home:bookSpines:${index}:${width}x${height}:${shelves}`, () => {
        const parts = [], rowH = height / shelves;
        for (let s = 0; s < shelves; s++) {
          const y0 = s * rowH + 0.06, h = rowH - 0.16;
          for (let i = 0; i < Math.floor((width - 0.2) / 0.07); i++) {
            if ((i * 7 + s * 3 + index) % PALETTE.home.bookSpines.length !== index) continue;
            const hh = h * (0.78 + 0.2 * (((i * 13 + s * 5) % 7) / 6));
            parts.push(block(THREE, 0.055, hh, depth - 0.16, at(-width / 2 + 0.13 + i * 0.07, y0 + hh / 2, 0.03), 0));
          }
        }
        return parts.length ? mergeGeometries(THREE, parts) : block(THREE, 0.001, 0.001, 0.001, at(0, 0, 0), 0);
      });
      const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, `bookSpine${index}`, hex, SURFACE.paint));
      mesh.name = `M_bookcase_spines_${index}`;
      return mesh;
    });
    return { meshes: [frame, ...spines], sockets: {}, info: { width, depth, height, shelves, spineColors: PALETTE.home.bookSpines, note: 'Spines are plain colour blocks; no title, letter or number is modelled.' } };
  },
  'prop.side-table': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.sideTable;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth), height = num(variant.height, d.height);
    const geo = scope.shared(`geometry:home:sideTable:${width}x${depth}x${height}`, () => {
      const parts = [tint(THREE, block(THREE, width, 0.07, depth, at(0, height - 0.035, 0), 0.008), 1.08)];
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        parts.push(tint(THREE, block(THREE, 0.07, height - 0.07, 0.07, at(sx * (width / 2 - 0.06), (height - 0.07) / 2, sz * (depth / 2 - 0.06)), 0.008), 0.84));
      }
      return mergeGeometries(THREE, parts);
    });
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'sideTableWood', PALETTE.home.sideTableWood, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_side_table'; mesh.castShadow = true; mesh.receiveShadow = true;
    return { meshes: [mesh], sockets: { socket_top: [0, height, 0] }, info: { width, depth, height } };
  },

  // ---- Reception ----
  'prop.reception-counter': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.counter;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth), height = num(variant.height, d.height);
    const bodyGeo = scope.shared(`geometry:recep:counter:${width}x${depth}x${height}`, () => {
      const parts = [verticalTint(THREE, block(THREE, width, height - 0.07, depth, at(0, (height - 0.07) / 2, 0)), 0, height, 0.74, 1.0)];
      // Vertical panelling on the two visible faces, as the source paints it.
      const slats = Math.max(3, Math.round(depth / 0.22));
      for (let i = 0; i < slats; i++) {
        parts.push(tint(THREE, block(THREE, 0.02, height - 0.24, 0.02, at(width / 2 + 0.005, (height - 0.24) / 2, -depth / 2 + (depth * (i + 0.5)) / slats), 0), 0.66));
      }
      parts.push(tint(THREE, block(THREE, width + 0.09, 0.07, depth + 0.09, at(0, height - 0.035, 0), 0.008), 1.22));   // the lighter worktop
      return mergeGeometries(THREE, parts);
    });
    const body = new THREE.Mesh(bodyGeo, sharedMaterial(THREE, scope, 'counterWood', PALETTE.reception.counterFront, { ...SURFACE.timber, vertexColors: true }));
    body.name = 'M_counter_body'; body.castShadow = true; body.receiveShadow = true;
    const meshes = [body];
    if (variant.monitor !== false) {
      const screenGeo = scope.shared('geometry:recep:counterScreen', () => mergeGeometries(THREE, [
        block(THREE, 0.1, 0.06, 0.24, at(0, 0.03, 0), 0.008),                 // foot
        block(THREE, 0.06, 0.16, 0.06, at(0, 0.14, 0), 0.008),                // neck
        block(THREE, 0.07, 0.38, 0.62, at(0, 0.41, 0), 0.008)                 // panel, edge-on to the room
      ]));
      const screen = new THREE.Mesh(screenGeo, sharedMaterial(THREE, scope, 'counterScreen', PALETTE.studio.monitorFrame, SURFACE.paintedWood));
      screen.name = 'M_counter_screen'; screen.position.set(0, height, depth / 2 - 0.5); screen.castShadow = true;
      meshes.push(screen);
    }
    return { meshes, sockets: { socket_top: [0, height, 0] }, info: { width, depth, height, monitor: variant.monitor !== false, note: 'A working surface only: no leaflet, notice or lettering is modelled.' } };
  },
  'prop.waiting-bench': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.waitingBench;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth);
    const seatH = num(variant.seatHeight, d.seatHeight), seats = Math.max(1, Math.round(num(variant.seats, d.seats)));
    const fabricGeo = scope.shared(`geometry:recep:bench:${width}x${depth}x${seatH}:${seats}`, () => {
      const parts = [], pitch = depth / seats;
      for (let i = 0; i < seats; i++) {
        const cz = -depth / 2 + pitch * (i + 0.5);
        parts.push(tint(THREE, block(THREE, width - 0.3, 0.16, pitch - 0.07, at(0.05, seatH - 0.08, cz)), 1.04));                      // cushion
        parts.push(verticalTint(THREE, block(THREE, 0.16, 0.5, pitch - 0.07, at(-width / 2 + 0.16, seatH + 0.25, cz)), seatH, seatH + 0.5, 0.88, 1.06)); // back
      }
      return mergeGeometries(THREE, parts);
    });
    const fabric = new THREE.Mesh(fabricGeo, sharedMaterial(THREE, scope, 'benchFabric', PALETTE.reception.benchFabric, { ...SURFACE.fabric, vertexColors: true }));
    fabric.name = 'M_bench_fabric'; fabric.castShadow = true; fabric.receiveShadow = true;
    const frameGeo = scope.shared(`geometry:recep:benchFrame:${width}x${depth}x${seatH}`, () => {
      const parts = [block(THREE, width, 0.07, depth, at(0, seatH - 0.19, 0), 0.008)];
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        parts.push(block(THREE, 0.07, seatH - 0.19, 0.07, at(sx * (width / 2 - 0.06), (seatH - 0.19) / 2, sz * (depth / 2 - 0.06)), 0.008));
      }
      parts.push(block(THREE, 0.09, 0.09, depth, at(width / 2 - 0.08, seatH + 0.02, 0), 0.008));     // arm rail
      return mergeGeometries(THREE, parts);
    });
    const frame = new THREE.Mesh(frameGeo, sharedMaterial(THREE, scope, 'benchFrameWood', PALETTE.reception.benchFrame, SURFACE.timber));
    frame.name = 'M_bench_frame'; frame.castShadow = true;
    return { meshes: [fabric, frame], sockets: {}, info: { width, depth, seatHeight: seatH, seats, note: 'Seating only; the host owns whether any of it is sittable.' } };
  },
  // A blank wall board. The source paints lettering on it; the pack ships the
  // panel and its frame, and the wording stays with the integration, exactly
  // as slide text stays off the studio monitor.
  'prop.sign-board': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.signBoard;
    const width = num(variant.width, d.width), height = num(variant.height, d.height);
    const geo = scope.shared(`geometry:sign:${width}x${height}`, () => mergeGeometries(THREE, [
      tint(THREE, block(THREE, width, height, 0.07, at(0, 0, 0), 0.01), 1),
      tint(THREE, block(THREE, width + 0.07, height + 0.07, 0.04, at(0, 0, -0.02), 0.008), 0.8)
    ]));
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'signBoard', PALETTE.reception.signBoard, { ...SURFACE.paintedWood, vertexColors: true }));
    mesh.name = 'M_sign_board'; mesh.castShadow = true;
    return {
      meshes: [mesh], sockets: { socket_legend: [0, 0, 0.036] },
      info: { width, height, blank: true, legend: 'The pack ships no lettering. socket_legend marks the face the host may draw or project its own wording onto.' }
    };
  },

  // ---- Street ----
  'street.building': (THREE, scope, variant) => {
    const width = num(variant.width, 19), height = num(variant.height, HOME_STREET_DEFAULTS.building.height);
    const depth = num(variant.depth, HOME_STREET_DEFAULTS.building.depth);
    const opening = variant.opening && Number.isFinite(variant.opening.width) ? variant.opening : null;
    const geo = scope.shared(`geometry:street:building:${width}x${height}x${depth}:${opening ? `${opening.width}@${opening.x}` : 'solid'}`, () => {
      const parts = [], oW = opening ? opening.width : 0, oH = opening ? num(opening.height, 2.3) : 0, oX = opening ? num(opening.x, 0) : 0;
      if (opening) {
        for (const [from, to] of [[-width / 2, oX - oW / 2], [oX + oW / 2, width / 2]]) {
          if (to - from > 0.01) parts.push(verticalTint(THREE, block(THREE, to - from, height, depth, at((from + to) / 2, height / 2, 0)), 0, height, 0.76, 1.0));
        }
        parts.push(verticalTint(THREE, block(THREE, oW, height - oH, depth, at(oX, oH + (height - oH) / 2, 0)), 0, height, 0.8, 1.0));
      } else {
        parts.push(verticalTint(THREE, block(THREE, width, height, depth, at(0, height / 2, 0)), 0, height, 0.76, 1.0));
      }
      parts.push(tint(THREE, block(THREE, width + 0.12, 0.16, depth + 0.12, at(0, height - 0.08, 0), 0.01), 1.18));   // parapet band
      parts.push(tint(THREE, block(THREE, width, 0.12, depth + 0.06, at(0, 0.06, 0), 0.01), 0.7));                    // plinth
      return mergeGeometries(THREE, parts);
    });
    const body = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'streetFacade', PALETTE.street.facade, { ...SURFACE.plaster, vertexColors: true }));
    body.name = 'M_building_body'; body.castShadow = true; body.receiveShadow = true;
    // One band of shopfront glazing, split into bays. Flat panels, no interior.
    const bays = Math.max(2, Math.round(width / 2.2));
    const glassGeo = scope.shared(`geometry:street:buildingGlass:${width}x${height}:${bays}`, () => mergeGeometries(THREE, Array.from({ length: bays }, (_, i) =>
      block(THREE, (width / bays) - 0.5, 1.15, 0.05, at(-width / 2 + (width * (i + 0.5)) / bays, height * 0.58, depth / 2 + 0.02), 0.008))));
    const glass = new THREE.Mesh(glassGeo, sharedMaterial(THREE, scope, 'facadeGlass', PALETTE.street.facadeGlass, SURFACE.glass));
    glass.name = 'M_building_glazing';
    return { meshes: [body, glass], sockets: {}, info: { width, height, depth, opening, bays, note: 'Frontage only: the building has no interior and no sign. Its height and depth are authored.' } };
  },
  'street.road': (THREE, scope, variant) => {
    const width = num(variant.width, 19), depth = num(variant.depth, 2.9);
    const kerb = num(variant.kerb, HOME_STREET_DEFAULTS.roadKerb);
    const surfaceGeo = scope.shared(`geometry:street:road:${width}x${depth}`, () => block(THREE, width, 0.04, depth, at(0, 0.02, 0), 0.01));
    const surface = new THREE.Mesh(surfaceGeo, sharedMaterial(THREE, scope, 'roadAsphalt', PALETTE.street.road, SURFACE.asphalt));
    surface.name = 'M_road_surface'; surface.receiveShadow = true;
    const kerbGeo = scope.shared(`geometry:street:kerb:${width}x${depth}x${kerb}`, () => mergeGeometries(THREE, [-1, 1].map(s =>
      verticalTint(THREE, block(THREE, width, kerb, 0.22, at(0, kerb / 2, s * (depth / 2 + 0.11)), 0.01), 0, kerb, 0.82, 1.06))));
    const kerbs = new THREE.Mesh(kerbGeo, sharedMaterial(THREE, scope, 'roadKerb', PALETTE.street.curb, { ...SURFACE.stone, vertexColors: true }));
    kerbs.name = 'M_road_kerbs'; kerbs.receiveShadow = true; kerbs.castShadow = true;
    const dashes = Math.max(2, Math.round(width / 1.6));
    const laneGeo = scope.shared(`geometry:street:lane:${width}:${dashes}`, () => mergeGeometries(THREE, Array.from({ length: dashes }, (_, i) =>
      block(THREE, 0.8, 0.012, 0.09, at(-width / 2 + (width * (i + 0.5)) / dashes, 0.046, 0), 0))));
    const lane = new THREE.Mesh(laneGeo, sharedMaterial(THREE, scope, 'roadLaneMark', PALETTE.street.laneMark, SURFACE.paint));
    lane.name = 'M_road_lane_marking';
    return { meshes: [surface, kerbs, lane], sockets: {}, info: { width, depth, kerb, dashes, note: 'Surface, kerbs and the centre dashes only. Crossing safety and traffic stay with the host.' } };
  },
  'street.crossing': (THREE, scope, variant) => {
    const width = num(variant.width, 2.56), depth = num(variant.depth, 2.9);
    const stripes = Math.max(2, Math.round(num(variant.stripes, Math.round(depth / 0.42))));
    const geo = scope.shared(`geometry:street:crossing:${width}x${depth}:${stripes}`, () => mergeGeometries(THREE, Array.from({ length: stripes }, (_, i) =>
      block(THREE, width, 0.014, (depth / stripes) * 0.55, at(0, 0.048, -depth / 2 + (depth * (i + 0.5)) / stripes), 0))));
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'crossingPaint', PALETTE.street.crossing, SURFACE.paint));
    mesh.name = 'M_crossing'; mesh.receiveShadow = true;
    return { meshes: [mesh], sockets: {}, info: { width, depth, stripes, note: 'Paint only: it adds no collision and grants no right of way. Whether the crossing is clear stays with the host.' } };
  },
  'prop.car': (THREE, scope, variant) => {
    const id = typeof variant === 'string' ? variant : variant.variant || variant.id || 'car-0';
    const car = CAR_VARIANTS.find(c => c.id === id);
    if (!car) throw new RangeError(`Unknown car variant "${id}". Known: ${CAR_VARIANTS.map(c => c.id).join(', ')}.`);
    const length = +(car.widthLogical * S).toFixed(4), width = +(car.depthLogical * S).toFixed(4);
    const height = num(variant.height, HOME_STREET_DEFAULTS.carHeight);
    const wheelR = 0.14, sill = wheelR + 0.02;
    const bodyGeo = scope.shared(`geometry:street:carBody:${id}:${height}`, () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, length, height - sill - 0.3, width, at(0, sill + (height - sill - 0.3) / 2, 0), 0.02), sill, height, 0.84, 1.04),
      tint(THREE, block(THREE, length * 0.56, 0.32, width - 0.1, at(-length * 0.04, height - 0.16, 0), 0.02), 1.0)         // cabin box
    ]));
    const body = new THREE.Mesh(bodyGeo, sharedMaterial(THREE, scope, `carBody:${id}`, car.color, { ...SURFACE.carPaint, vertexColors: true }));
    body.name = 'M_car_body'; body.castShadow = true; body.receiveShadow = true;
    const glassGeo = scope.shared(`geometry:street:carGlass:${id}:${height}`, () => mergeGeometries(THREE, [
      block(THREE, length * 0.5, 0.2, width - 0.06, at(-length * 0.04, height - 0.14, 0), 0.01),
      ...[-1, 1].map(s => block(THREE, length * 0.48, 0.18, 0.03, at(-length * 0.04, height - 0.15, s * (width / 2 - 0.02)), 0.006))
    ]));
    const glass = new THREE.Mesh(glassGeo, sharedMaterial(THREE, scope, 'carGlass', PALETTE.car.cabin, SURFACE.glass));
    glass.name = 'M_car_glazing';
    const wheelGeo = scope.shared(`geometry:street:carWheels:${id}`, () => mergeGeometries(THREE, [-1, 1].flatMap(sz => [-1, 1].map(sx =>
      block(THREE, 0.26, wheelR * 2, 0.14, at(sx * (length / 2 - 0.34), wheelR, sz * (width / 2 - 0.05)), 0.02)))));
    const wheels = new THREE.Mesh(wheelGeo, sharedMaterial(THREE, scope, 'carWheel', PALETTE.car.wheel, SURFACE.rubber));
    wheels.name = 'M_car_wheels'; wheels.castShadow = true;
    const lampGeo = scope.shared(`geometry:street:carLamps:${id}:${height}`, () => mergeGeometries(THREE, [-1, 1].map(s =>
      block(THREE, 0.06, 0.1, 0.16, at(car.direction * (length / 2 - 0.02), sill + 0.22, s * (width / 2 - 0.16)), 0.01))));
    const lamps = new THREE.Mesh(lampGeo, sharedMaterial(THREE, scope, 'carLamp', PALETTE.car.headlight, SURFACE.paint));
    lamps.name = 'M_car_lamps';
    return {
      meshes: [body, glass, wheels, lamps], sockets: {},
      info: { variant: id, length, width, height, color: car.color, laneLogicalY: car.laneLogicalY, direction: car.direction,
        note: 'Body only. Position is a function of the clock in simulation.mjs carsAt(); the host drives it, and the lamps are painted, never emissive.' }
    };
  },
  'prop.house': (THREE, scope, variant) => {
    const d = HOME_STREET_DEFAULTS.house;
    const width = num(variant.width, d.width), depth = num(variant.depth, d.depth), height = num(variant.height, d.height);
    const wallGeo = scope.shared(`geometry:street:house:${width}x${depth}x${height}`, () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, width, height, depth, at(0, height / 2, 0)), 0, height, 0.8, 1.02),
      tint(THREE, block(THREE, width + 0.14, 0.14, depth + 0.14, at(0, height + 0.07, 0), 0.01), 0.42)         // dark coping, as painted
    ]));
    const walls = new THREE.Mesh(wallGeo, sharedMaterial(THREE, scope, 'houseWall', PALETTE.street.houseWall, { ...SURFACE.plaster, vertexColors: true }));
    walls.name = 'M_house_walls'; walls.castShadow = true; walls.receiveShadow = true;
    const doorGeo = scope.shared('geometry:street:houseDoor', () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, 0.86, 1.95, 0.08, at(0, 0.975, 0), 0.01), 0, 1.95, 0.84, 1.04),
      tint(THREE, block(THREE, 0.98, 2.07, 0.05, at(0, 1.035, -0.02), 0.008), 0.66)
    ]));
    const door = new THREE.Mesh(doorGeo, sharedMaterial(THREE, scope, 'houseDoor', PALETTE.street.houseDoor, { ...SURFACE.timber, vertexColors: true }));
    door.name = 'M_house_door'; door.position.set(num(variant.doorX, 0), 0, depth / 2 + 0.03); door.castShadow = true;
    return { meshes: [walls, door], sockets: { socket_door: [num(variant.doorX, 0), 0, depth / 2 + 0.06] }, info: { width, depth, height, note: 'The street-side house front. Its width and depth are the logical solid; the height is authored.' } };
  },
  'prop.street-bench': (THREE, scope, variant) => {
    const width = num(variant.width, 1.4), depth = num(variant.depth, 0.5), seatH = num(variant.seatHeight, 0.44);
    const geo = scope.shared(`geometry:street:bench:${width}x${depth}x${seatH}`, () => {
      const parts = [];
      for (let i = 0; i < 3; i++) parts.push(tint(THREE, block(THREE, width, 0.05, depth / 3.4, at(0, seatH, -depth / 2 + (depth * (i + 0.6)) / 3.4), 0.008), 1 + (i % 2 ? -0.04 : 0.04)));
      for (let i = 0; i < 3; i++) parts.push(tint(THREE, block(THREE, width, 0.05, 0.05, at(0, seatH + 0.16 + i * 0.13, -depth / 2 + 0.04), 0.008), 0.96));
      for (const s of [-1, 1]) {
        parts.push(tint(THREE, block(THREE, 0.08, seatH, 0.08, at(s * (width / 2 - 0.08), seatH / 2, depth / 2 - 0.08), 0.008), 0.78));
        parts.push(tint(THREE, block(THREE, 0.08, seatH + 0.5, 0.08, at(s * (width / 2 - 0.08), (seatH + 0.5) / 2, -depth / 2 + 0.05), 0.008), 0.78));
      }
      return mergeGeometries(THREE, parts);
    });
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'streetBenchWood', PALETTE.street.benchWood, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_street_bench'; mesh.castShadow = true; mesh.receiveShadow = true;
    return { meshes: [mesh], sockets: {}, info: { width, depth, seatHeight: seatH } };
  },
  'prop.hedge': (THREE, scope, variant) => {
    const width = num(variant.width, 3), depth = num(variant.depth, HOME_STREET_DEFAULTS.hedge.depth);
    const height = num(variant.height, HOME_STREET_DEFAULTS.hedge.height);
    const planterH = 0.26;
    const planterGeo = scope.shared(`geometry:street:planter:${width}x${depth}`, () => verticalTint(THREE,
      block(THREE, width, planterH, depth, at(0, planterH / 2, 0), 0.01), 0, planterH, 0.74, 1.04));
    const planter = new THREE.Mesh(planterGeo, sharedMaterial(THREE, scope, 'planterStone', PALETTE.street.curb, { ...SURFACE.stone, vertexColors: true }));
    planter.name = 'M_hedge_planter'; planter.castShadow = true; planter.receiveShadow = true;
    const leafGeo = scope.shared(`geometry:street:hedge:${width}x${depth}x${height}`, () => {
      const parts = [], cells = Math.max(2, Math.round(width / 0.34));
      for (let i = 0; i < cells; i++) {
        const h = height - planterH - 0.04 * (((i * 5) % 3) / 2);
        parts.push(tint(THREE, block(THREE, width / cells - 0.02, h, depth - 0.12, at(-width / 2 + (width * (i + 0.5)) / cells, planterH + h / 2, 0), 0.01), 0.92 + 0.1 * ((i % 3) / 2)));
      }
      return mergeGeometries(THREE, parts);
    });
    const leaves = new THREE.Mesh(leafGeo, sharedMaterial(THREE, scope, 'hedgeLeaf', PALETTE.street.hedge, { ...SURFACE.leaf, vertexColors: true }));
    leaves.name = 'M_hedge_leaves'; leaves.castShadow = true;
    return { meshes: [planter, leaves], sockets: {}, info: { width, depth, height, note: 'Planting along the street edge; it adds no obstacle the host does not already have.' } };
  }
};

function wheelMeshes(THREE, scope, width, count) {
  const geo = scope.shared(`geometry:ride:wheels:${width}:${count}`, () => {
    const parts = [], zs = count === 2 ? [-DECK.axleZ, DECK.axleZ] : [-DECK.axleZ, -DECK.axleZ, DECK.axleZ, DECK.axleZ];
    const xs = count === 2 ? [0, 0] : [-1, 1, -1, 1];
    for (let i = 0; i < zs.length; i++) {
      const x = count === 2 ? 0 : xs[i] * (width / 2 - 0.02);
      parts.push(block(THREE, count === 2 ? width - 0.06 : 0.05, DECK.wheelRadius * 2, DECK.wheelRadius * 2, at(x, DECK.wheelRadius, zs[i]), 0.01));
    }
    return mergeGeometries(THREE, parts);
  });
  const wheels = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'rideWheel', PALETTE.ride.wheel, SURFACE.rubber));
  wheels.name = 'M_ride_wheels'; wheels.castShadow = true;
  const hubGeo = scope.shared(`geometry:ride:hubs:${width}:${count}`, () => mergeGeometries(THREE,
    (count === 2 ? [-DECK.axleZ, DECK.axleZ] : [-DECK.axleZ, DECK.axleZ]).map(z =>
      block(THREE, width + 0.02, 0.03, 0.03, at(0, DECK.wheelRadius, z), 0))));
  const hubs = new THREE.Mesh(hubGeo, sharedMaterial(THREE, scope, 'rideHub', PALETTE.ride.hub, SURFACE.frame));
  hubs.name = 'M_ride_axles';
  return [wheels, hubs];
}

// The painted timber stand a parked ride rests on in home.png.
function standMesh(THREE, scope) {
  const geo = scope.shared('geometry:home:rideStand', () => mergeGeometries(THREE, [
    tint(THREE, block(THREE, 0.5, 0.05, 0.94, at(0, 0.025, 0), 0.008), 1.06),
    tint(THREE, block(THREE, 0.44, 0.09, 0.2, at(0, 0.075, -0.3), 0.008), 0.86)
  ]));
  const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'rideStand', PALETTE.home.rideStand, { ...SURFACE.timber, vertexColors: true }));
  mesh.name = 'M_ride_stand'; mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}

export const HOME_STREET_COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));
export const RIDE_COMPONENT_IDS = Object.freeze(['prop.scooter', 'prop.skateboard']);
export { RIDE_IDENTITIES };

export function createHomeStreetComponent(THREE, scope, { assetId, variant = {}, packVersion }) {
  const build = COMPONENTS[assetId];
  if (!build) throw new RangeError(`Unknown Home/Street component "${assetId}". Known: ${HOME_STREET_COMPONENT_IDS.join(', ')}.`);
  const root = new THREE.Group();
  root.name = assetId.replace(/[.-]/g, '_');
  root.userData.belAsset = { assetId, variant, packVersion };
  const { meshes, sockets = {}, info } = build(THREE, scope, variant);
  root.add(...meshes);
  const socketObjects = {};
  for (const [name, position] of Object.entries(sockets)) {
    const object = new THREE.Object3D();
    object.name = name;
    object.position.set(...position);
    root.add(object);
    socketObjects[name] = object;
  }
  return {
    root, clips: [], sockets: socketObjects, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'Home / Street / Reception kit component (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — the existing painted inventory rebuilt as cuboids with real depth and material separation',
      component: assetId, variant, ...info,
      triangles: countTriangles(root), meshes: meshes.length,
      placement: 'Gemini places this at the existing logical rectangles; the component holds no scene position and no collision.'
    }
  };
}
