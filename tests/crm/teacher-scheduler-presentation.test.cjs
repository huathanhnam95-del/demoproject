const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['teacher-scheduler-presentation.js', 'teacher-scheduler-colors.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/js/crm', file), 'utf8'), context);
}
const { classTitle, customTheme, resolveColor } = context.TeacherSchedulerPresentation;
assert.equal(classTitle('Trần Văn Hạnh - PTE Academic 1-1 24h').primary, 'Trần Văn Hạnh');
assert.equal(classTitle('Trần Văn Hạnh - PTE Academic 1-1 24h').secondary, 'PTE Academic 1-1 24h');
for (const value of ['PTE 1-1', 'Reading & Listening', 'Nguyễn Thị Duy Tuyền']) assert.equal(classTitle(value).primary, value);
assert.equal(classTitle('Name – Course — Extra').secondary, 'Course — Extra');
function luminance(hex) {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
const samples = [...context.TeacherSchedulerColors.PALETTE, '#000000', '#FFFFFF', '#767676', '#777777', '#00FF00'];
for (const hex of samples) {
    const theme = customTheme(hex);
    const l = luminance(hex), text = luminance(theme.title);
    assert.ok((Math.max(l, text) + .05) / (Math.min(l, text) + .05) >= 4.5, `Contrast for ${hex}`);
    assert.equal(theme.meta, theme.title);
    assert.equal(theme.background, hex);
}
assert.equal(customTheme('red; background:url(x)'), null);
const server = require('../../functions/src/crm/scheduler-color-service');
let plan;
const anchor = { sessionId: 'anchor', scheduledStartAtUtc: '2026-09-22T09:00:00+07:00' };
for (const [scope, color] of [['all', '#000000'], ['following', '#00FF00'], ['session', null]]) {
    plan = server.applyColor(plan, anchor, { scope, color, expectedRevision: plan?.revision || 0 });
    for (const session of [anchor, { sessionId: 'past', scheduledStartAtUtc: '2026-09-21T02:00:00Z' }, { sessionId: 'future', scheduledStartAtUtc: '2027-10-01T02:00:00Z' }]) {
        assert.equal(resolveColor(plan, session), server.resolveColor(plan, session));
    }
}
console.log('Scheduler presentation: Vietnamese titles, palette contrast, and server/client scope parity passed.');
