import { SCENES } from './core/world/scenes.mjs';
import { solidsFor } from './core/world/simulation.mjs';
import { distance, move, valid, vector } from './core/world/geometry.mjs';

// Render-only prediction. Commands still contain directions, never positions.
// Keep a continuous local pose and ease snapshot corrections onto the same
// collision geometry. A stalled connection cannot predict indefinitely.
export class LocalMovement {
  reset() { this.visual = null; this.tick = null; }
  sample(world, id, keys, now, blocked) {
    const player = world.players[id], scene = SCENES[player.scene];
    const radius = player.ride ? 15 : 10, solids = solidsFor(world, id);
    const changed = !this.visual || this.visual.instance !== player.instance ||
      this.visual.resetUntil !== player.resetUntil || this.visual.ride !== player.ride;
    if (changed || this.tick !== world.tickAt) { this.tick = world.tickAt; this.receivedAt = now; }
    const age = now - this.receivedAt;
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastAt ?? now)) / 1000));
    this.lastAt = now;
    if (changed || blocked || player.seat || player.leader || player.follower || age > 500 ||
      distance(this.visual, player) > 80 || !valid(this.visual, scene, solids, radius)) {
      this.visual = { ...player }; return this.visual;
    }
    const direction = vector({ w:false, a:false, s:false, d:false, ...keys }), speed = player.ride ? 165 : 108;
    if (player.scene === 'I' && world.reversal.debuffs[id] > 0) { direction.x *= -1; direction.y *= -1; }
    const before = this.visual;
    const position = move(before, direction.x * speed * dt, direction.y * speed * dt, scene, solids, radius);
    const target = move(player, direction.x * speed * Math.min(age, 250) / 1000,
      direction.y * speed * Math.min(age, 250) / 1000, scene, solids, radius);
    const blend = 1 - Math.exp(-dt / 0.15);
    const corrected = move(position, (target.x-position.x)*blend, (target.y-position.y)*blend, scene, solids, radius);
    const traveled = distance(before, corrected);
    this.visual = { ...player, ...corrected, distance: (before.distance || 0) + traveled,
      pose: player.ride ? (traveled > .01 ? 'riding' : 'coasting') : player.carry ? 'carrying' : traveled > .01 && (direction.x || direction.y) ? 'walking' : 'idle',
      facing: direction.x || direction.y ? Math.abs(direction.x) > Math.abs(direction.y) ? direction.x > 0 ? 'right' : 'left' : direction.y > 0 ? 'down' : 'up' : before.facing };
    return this.visual;
  }
}
