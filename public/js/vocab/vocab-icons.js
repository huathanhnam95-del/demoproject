/**
 * vocab-icons.js — inline SVG icons for the Vocabulary Book.
 *
 * Follows the repo's established convention (see js/crm/books-workspace.js):
 * viewBox="0 0 24 24", explicit width/height, `fill="currentColor"` for solid or
 * `fill="none" stroke="currentColor"` for outline. Inline SVG rather than the
 * Material Symbols font so these work on every page, and rather than emoji so the
 * icon language is consistent and colour-controllable.
 */

const outline = (paths, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" `
    + `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" `
    + `focusable="false">${paths}</svg>`;

/** Speaker — replaces the 🔊 emoji on every row. */
export const ICON_SPEAKER = outline(
    '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
);

/** Chevron used for the row disclosure. */
export const ICON_CHEVRON = outline('<path d="m6 9 6 6 6-6"/>', 16);

/** Remove / delete a bookmark. */
export const ICON_TRASH = outline(
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
);

/** Search field affordance. */
export const ICON_SEARCH = outline('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16);

/** Clear an active filter/search. */
export const ICON_CLOSE = outline('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 16);

/** Empty-state illustration. */
export const ICON_BOOK = outline(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>'
    + '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    40
);

/** Empty-state illustration for "nothing matched the filters". */
export const ICON_NO_RESULTS = outline(
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8.5 11h5"/>',
    40
);
