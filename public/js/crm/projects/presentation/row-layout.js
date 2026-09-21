(function (scope) {
    'use strict';

    function createRowLayoutAdapter(options = {}) {
        let activeComposer = null; // { anchorIndex, height, id }

        return {
            setActiveComposer(composer) {
                activeComposer = composer;
            },
            getActiveComposer() {
                return activeComposer;
            },
            clearActiveComposer() {
                activeComposer = null;
            },
            getRowOffset(rowIndex, baseRowHeight) {
                const rowH = Number.isFinite(baseRowHeight) && baseRowHeight > 0 ? baseRowHeight : 44;
                const rIndex = Number.isFinite(rowIndex) ? Math.max(0, rowIndex) : 0;
                if (!activeComposer || activeComposer.anchorIndex == null) {
                    return rIndex * rowH;
                }
                const offset = Math.max(0, Number.isFinite(activeComposer.height) ? activeComposer.height : rowH);
                if (activeComposer.placement === 'before') {
                    if (rIndex < activeComposer.anchorIndex) return rIndex * rowH;
                    return (rIndex * rowH) + offset;
                }
                if (rIndex <= activeComposer.anchorIndex) {
                    return rIndex * rowH;
                }
                return (rIndex * rowH) + offset;
            },
            getComposerOffset(baseRowHeight) {
                const rowH = Number.isFinite(baseRowHeight) && baseRowHeight > 0 ? baseRowHeight : 44;
                if (!activeComposer || activeComposer.anchorIndex == null) return 0;
                if (activeComposer.placement === 'before') {
                    return Math.max(0, activeComposer.anchorIndex) * rowH;
                }
                return (Math.max(0, activeComposer.anchorIndex) + 1) * rowH;
            },
            getTotalHeight(rowCount, baseRowHeight) {
                const rowH = Number.isFinite(baseRowHeight) && baseRowHeight > 0 ? baseRowHeight : 44;
                const count = Number.isFinite(rowCount) ? Math.max(0, rowCount) : 0;
                const base = count * rowH;
                if (!activeComposer || activeComposer.anchorIndex == null) return base;
                const offset = Math.max(0, Number.isFinite(activeComposer.height) ? activeComposer.height : rowH);
                return base + offset;
            },
            dispose() {
                activeComposer = null;
            }
        };
    }

    scope.CrmProjectsRowLayoutV2 = { createRowLayoutAdapter };
})(typeof window !== 'undefined' ? window : globalThis);
