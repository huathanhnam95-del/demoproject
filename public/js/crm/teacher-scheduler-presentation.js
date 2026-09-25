(function (root) {
    'use strict';

    // Split only explicit name/course separators; preserve every original character in details.
    function classTitle(value) {
        const full = String(value || 'Class').trim();
        const match = /\s[-–—]\s/.exec(full);
        if (!match || match.index === 0) return { full, primary: full, secondary: '' };
        const primary = full.slice(0, match.index).trim();
        const secondary = full.slice(match.index + match[0].length).trim();
        return secondary ? { full, primary, secondary } : { full, primary: full, secondary: '' };
    }

    function resolveColor(plan, session) {
        const date = session?.scheduledStartAtUtc ? new Date(session.scheduledStartAtUtc) : null;
        const start = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
        const rules = Array.isArray(plan?.rules) ? plan.rules : [];
        for (let i = rules.length - 1; i >= 0; i -= 1) {
            const rule = rules[i];
            if (rule.scope === 'all'
                || (rule.scope === 'session' && rule.sessionId === session.sessionId)
                || (rule.scope === 'following' && (rule.sessionId === session.sessionId || (start && start >= rule.fromUtc)))) return rule.color;
        }
        return null;
    }

    function customTheme(color) {
        if (!/^#[0-9a-f]{6}$/i.test(color || '')) return null;
        const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
            .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        const ink = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
        return { background: color, title: ink, meta: ink, accent: color, hoverBackground: color, focusOutline: ink };
    }

    root.TeacherSchedulerPresentation = { classTitle, resolveColor, customTheme };
})(typeof window !== 'undefined' ? window : globalThis);
