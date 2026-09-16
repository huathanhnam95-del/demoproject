import { SCENES } from './core/world/scenes.mjs';
import { solidsFor } from './core/world/simulation.mjs';
import { distance, move, valid, vector } from './core/world/geometry.mjs';

// Render-only prediction. Commands still contain directions, never positions.
// Keep a continuous local pose and ease snapshot corrections onto the same
// collision geometry. A stalled connection cannot predict indefinitely.
export class LocalMovement {
  reset() { this.visual = null; this.tick = null; this.lastAt = null; this.receivedAt = null; this.stoppedAt = null; this.stopPos = null; this.stopGrace = false; }
  sample(world, id, keys, now, blocked) {
    const player = world?.players?.[id];
    if (!player) return null;
    const scene = SCENES[player.scene];
    if (!scene) {
      this.stoppedAt = null;
      this.stopPos = null;
      this.stopGrace = false;
      this.visual = { ...player };
      return this.visual;
    }
    const radius = player.ride ? 15 : 10, solids = solidsFor(world, id);
    const changed = !this.visual || this.visual.scene !== player.scene || this.visual.instance !== player.instance ||
      this.visual.resetUntil !== player.resetUntil || this.visual.ride !== player.ride;
    if (changed || this.tick !== world.tickAt) { this.tick = world.tickAt; this.receivedAt = now; }
    const age = now - (this.receivedAt ?? now);
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastAt ?? now)) / 1000));
    this.lastAt = now;
    const normalizedKeys = {
      w: Boolean(keys?.w || keys?.arrowup || keys?.ArrowUp),
      a: Boolean(keys?.a || keys?.arrowleft || keys?.ArrowLeft),
      s: Boolean(keys?.s || keys?.arrowdown || keys?.ArrowDown),
      d: Boolean(keys?.d || keys?.arrowright || keys?.ArrowRight)
    };
    const hasKeys = normalizedKeys.w || normalizedKeys.a || normalizedKeys.s || normalizedKeys.d;
    const maxAge = hasKeys ? 1500 : 500;
    if (changed || blocked || player.seat || player.leader || player.follower || age > maxAge ||
      distance(this.visual, player) > 80 || !valid(this.visual, scene, solids, radius)) {
      this.visual = {
        ...player,
        facingDir: (player.facingDir === -1 || player.facingDir === 1) ? player.facingDir : (player.facing === 'left' ? -1 : 1)
      };
      this.stoppedAt = null;
      this.stopPos = null;
      this.stopGrace = false;
      return this.visual;
    }
    const direction = vector(normalizedKeys), speed = player.ride ? 165 : 108;
    if (player.scene === 'I' && world.reversal?.debuffs?.[id] > 0) { direction.x *= -1; direction.y *= -1; }
    const isMoving = Boolean(direction.x || direction.y);
    const before = this.visual;
    let corrected;
    if (isMoving) {
      this.stoppedAt = null;
      this.stopPos = null;
      this.stopGrace = false;
      const position = move(before, direction.x * speed * dt, direction.y * speed * dt, scene, solids, radius);
      // During travel, client prediction naturally leads lagging server snapshots by in-flight network latency.
      // We avoid projecting total position offset against instantaneous input direction, which broke on 90-degree
      // turns and diagonal wall sliding. Instead:
      // 1. Clamp radial prediction distance so lead never exceeds 45px ahead of authoritative server snapshot.
      // 2. If the client ever drops behind the server snapshot in the direction of travel (dot < -2), smoothly catch up.
      const dist = distance(position, player);
      let adjustX = 0, adjustY = 0;
      if (dist > 45) {
        const excess = dist - 45;
        const blend = 1 - Math.exp(-dt / 0.02);
        const ratio = (excess * blend) / dist;
        adjustX += (player.x - position.x) * ratio;
        adjustY += (player.y - position.y) * ratio;
      }
      const dot = (position.x - player.x) * direction.x + (position.y - player.y) * direction.y;
      if (dot < -2) {
        const catchUp = 1 - Math.exp(-dt / 0.15);
        const boost = (-dot) * catchUp;
        adjustX += direction.x * boost;
        adjustY += direction.y * boost;
      }
      corrected = (adjustX !== 0 || adjustY !== 0)
        ? move(position, adjustX, adjustY, scene, solids, radius)
        : position;
    } else {
      if (this.stoppedAt === null) {
        this.stoppedAt = now;
        this.stopPos = { x: before.x, y: before.y };
        this.stopGrace = distance(this.stopPos, player) <= 45;
      }
      const stopAge = now - this.stoppedAt;
      if (this.stopGrace && stopAge < 250) {
        corrected = this.stopPos;
      } else {
        const blend = 1 - Math.exp(-dt / 0.15);
        corrected = move(before, (player.x - before.x) * blend, (player.y - before.y) * blend, scene, solids, radius);
        if (distance(corrected, player) < 0.05) {
          corrected = { x: player.x, y: player.y };
        }
      }
    }
    const traveled = distance(before, corrected);
    let facing = before.facing || player.facing || 'down';
    let facingDir = (before.facingDir === -1 || before.facingDir === 1)
      ? before.facingDir
      : (before.facing === 'left' || player.facing === 'left' ? -1 : 1);
    if (isMoving) {
      if (Math.abs(direction.x) >= Math.abs(direction.y) && direction.x !== 0) {
        facing = direction.x > 0 ? 'right' : 'left';
        facingDir = direction.x > 0 ? 1 : -1;
      } else if (direction.y !== 0) {
        facing = direction.y > 0 ? 'down' : 'up';
      }
    }
    this.visual = {
      ...player,
      ...corrected,
      distance: (before.distance || 0) + traveled,
      pose: player.ride
        ? (traveled > 0.01 ? 'riding' : 'coasting')
        : player.carry
        ? 'carrying'
        : isMoving && traveled > 0.01
        ? 'walking'
        : 'idle',
      facing,
      facingDir
    };
    return this.visual;
  }
}
