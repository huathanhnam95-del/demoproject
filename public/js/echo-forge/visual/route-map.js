// @ts-check

/**
 * Renders the branching route for one act.
 *
 * Pure DOM: it is handed everything it needs and holds nothing. Floors stack
 * bottom-up so progress reads as climbing, and only the nodes reachable from
 * where the player stands are enabled.
 */

import { ACTS, getNode } from '../core/route.js';

const NODE_GLYPH = Object.freeze({
  fight: '⚔',   // crossed swords
  rest: '☽',    // crescent
  cache: '◈',   // filled lozenge
  boss: '☠',    // skull
});

const NODE_KIND = Object.freeze({
  fight: 'Battle',
  rest: 'Rest',
  cache: 'Cache',
  boss: 'Warden',
});

/** SVG needs its own namespace or the nodes render as inert unknown elements. */
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Floors belonging to one act, ordered bottom-up for display.
 * @returns {Array<{ floor: number, nodes: readonly any[] }>}
 */
function actFloors(route, act) {
  return route.floors.filter((floor) => floor.act === act);
}

/**
 * Draw the connectors under the nodes.
 *
 * Positions are measured from the laid-out buttons rather than computed from
 * percentages, so the lines stay correct at any width without a second source
 * of truth for the layout.
 */
function drawConnectors(svg, board, route, act, nodeId) {
  const boardBox = board.getBoundingClientRect();
  if (!boardBox.width || !boardBox.height) return;

  svg.setAttribute('viewBox', `0 0 ${boardBox.width} ${boardBox.height}`);
  svg.replaceChildren();

  /** @param {string} id */
  const centreOf = (id) => {
    const button = board.querySelector(`[data-node-id="${id}"]`);
    if (!button) return null;
    const box = button.getBoundingClientRect();
    return {
      x: box.left - boardBox.left + box.width / 2,
      y: box.top - boardBox.top + box.height / 2,
    };
  };

  const inAct = new Set(
    actFloors(route, act).flatMap((floor) => floor.nodes.map((node) => node.id)),
  );

  for (const [fromId, toId] of route.edges) {
    if (!inAct.has(fromId) || !inAct.has(toId)) continue;
    const from = centreOf(fromId);
    const to = centreOf(toId);
    if (!from || !to) continue;

    const path = document.createElementNS(SVG_NS, 'path');
    const midY = (from.y + to.y) / 2;
    path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
    path.setAttribute('class', fromId === nodeId ? 'ef-link ef-link--live' : 'ef-link');
    svg.appendChild(path);
  }
}

/**
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {Object} options.route
 * @param {number} options.act
 * @param {string} options.nodeId          where the player stands
 * @param {readonly string[]} options.visitedNodeIds
 * @param {readonly string[]} options.availableNodeIds
 * @param {(nodeId: string) => void} options.onSelect
 */
export function renderRouteMap({
  container,
  route,
  act,
  nodeId,
  visitedNodeIds = [],
  availableNodeIds = [],
  onSelect,
}) {
  if (!container || !route) return;

  const meta = ACTS[act] || ACTS[0];
  const visited = new Set(visitedNodeIds);
  const available = new Set(availableNodeIds);
  const floors = actFloors(route, act);

  container.replaceChildren();

  // ── Act header ───────────────────────────────────────────────────────────
  const header = el('div', 'ef-map-header');
  header.appendChild(el('span', 'ef-map-numeral', `Act ${meta.numeral}`));
  header.appendChild(el('span', 'ef-map-title', meta.title));

  const pips = el('div', 'ef-map-pips');
  pips.setAttribute('aria-hidden', 'true');
  floors.forEach((floor) => {
    const reached = floor.nodes.some((node) => visited.has(node.id));
    pips.appendChild(el('span', reached ? 'ef-pip ef-pip--done' : 'ef-pip'));
  });
  header.appendChild(pips);
  container.appendChild(header);

  // ── Board ────────────────────────────────────────────────────────────────
  const board = el('div', 'ef-map-board');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'ef-map-links');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  board.appendChild(svg);

  // Bottom-up: the last floor of the act sits at the top of the screen.
  [...floors].reverse().forEach((floor) => {
    const row = el('div', 'ef-map-floor');
    row.dataset.floor = String(floor.floor);

    for (const node of floor.nodes) {
      const isVisited = visited.has(node.id);
      const isCurrent = node.id === nodeId;
      const isAvailable = available.has(node.id);

      const button = el('button', 'ef-map-node');
      button.type = 'button';
      button.dataset.nodeId = node.id;
      button.dataset.nodeType = node.type;
      button.dataset.state = isCurrent
        ? 'current'
        : isAvailable ? 'available' : isVisited ? 'visited' : 'locked';

      const glyph = el('span', 'ef-node-glyph', NODE_GLYPH[node.type] || '○');
      glyph.setAttribute('aria-hidden', 'true');
      button.appendChild(glyph);
      button.appendChild(el('span', 'ef-node-kind', NODE_KIND[node.type] || 'Site'));
      button.appendChild(el('span', 'ef-node-name', node.name));

      // State is carried by text, not colour alone.
      const stateWord = isCurrent ? 'you are here'
        : isAvailable ? 'available'
          : isVisited ? 'already visited' : 'not reachable from here';
      button.setAttribute('aria-label', `${NODE_KIND[node.type] || 'Site'}: ${node.name} — ${stateWord}`);

      if (isAvailable) {
        button.addEventListener('click', () => onSelect(node.id));
      } else {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }

      row.appendChild(button);
    }

    board.appendChild(row);
  });

  container.appendChild(board);

  const note = el('p', 'ef-map-note', available.size
    ? 'Choose where to go next.'
    : 'The way ahead is closed.');
  note.id = 'map-note';
  container.appendChild(note);

  // Connectors need the nodes laid out before they can be measured.
  drawConnectors(svg, board, route, act, nodeId);

  return () => drawConnectors(svg, board, route, act, nodeId);
}
