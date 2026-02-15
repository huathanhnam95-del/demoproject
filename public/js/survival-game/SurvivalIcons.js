/**
 * SurvivalIcons.js
 * Canonical icon paths for survival-mode power-ups and augments.
 */

const ICON_BASE = 'assets/survival-icons';

export const POWERUP_ICON_PATHS = {
    loot: `${ICON_BASE}/powerups/loot.png`,
    shield: `${ICON_BASE}/powerups/shield.png`,
    freeze: `${ICON_BASE}/powerups/freeze.png`,
    double_damage: `${ICON_BASE}/powerups/double_damage.png`,
    reroll: `${ICON_BASE}/powerups/reroll.png`,
    health: `${ICON_BASE}/powerups/health.png`
};

export const UPGRADE_ICON_PATHS = {
    dmg_boost: `${ICON_BASE}/upgrades/dmg_boost.png`,
    fire_rate: `${ICON_BASE}/upgrades/fire_rate.png`,
    multishot: `${ICON_BASE}/upgrades/multishot.png`,
    pierce: `${ICON_BASE}/upgrades/pierce.png`,
    speed: `${ICON_BASE}/upgrades/speed.png`,
    drone_count: `${ICON_BASE}/upgrades/drone_count.png`,
    drone_orbit: `${ICON_BASE}/upgrades/drone_orbit.png`,
    drone_damage: `${ICON_BASE}/upgrades/drone_damage.png`,
    mine_capacity: `${ICON_BASE}/upgrades/mine_capacity.png`,
    mine_damage: `${ICON_BASE}/upgrades/mine_damage.png`,
    mine_trigger: `${ICON_BASE}/upgrades/mine_trigger.png`,
    broadcaster: `${ICON_BASE}/upgrades/broadcaster.png`,
    heat_ray: `${ICON_BASE}/upgrades/heat_ray.png`,
    minefield: `${ICON_BASE}/upgrades/minefield.png`,
    sentry: `${ICON_BASE}/upgrades/sentry.png`,
    spectre: `${ICON_BASE}/upgrades/spectre.png`,
    tesla_mines: `${ICON_BASE}/upgrades/tesla_mines.png`,
    repeater_cryo: `${ICON_BASE}/upgrades/repeater_cryo.png`,
    heat_ray_reflector: `${ICON_BASE}/upgrades/heat_ray_reflector.png`,
    loot_heat_damage: `${ICON_BASE}/upgrades/loot_heat_damage.png`,
    loot_dot_damage: `${ICON_BASE}/upgrades/loot_dot_damage.png`,
    loot_turret_clock: `${ICON_BASE}/upgrades/loot_turret_clock.png`,
    loot_freeze_weight: `${ICON_BASE}/upgrades/loot_freeze_weight.png`,
    loot_shield_weight: `${ICON_BASE}/upgrades/loot_shield_weight.png`,
    loot_reroll_weight: `${ICON_BASE}/upgrades/loot_reroll_weight.png`,
    loot_item_life: `${ICON_BASE}/upgrades/loot_item_life.png`
};

export const UPGRADE_DEFAULT_ICON_PATH = `${ICON_BASE}/upgrades/default.png`;
export const LEVELUP_PROMPT_ICON_PATH = `${ICON_BASE}/ui/levelup_prompt.png`;

export function getUpgradeIconPath(augment) {
    if (!augment) return UPGRADE_DEFAULT_ICON_PATH;
    const direct = augment.id ? UPGRADE_ICON_PATHS[augment.id] : null;
    if (direct) return direct;
    return UPGRADE_DEFAULT_ICON_PATH;
}

