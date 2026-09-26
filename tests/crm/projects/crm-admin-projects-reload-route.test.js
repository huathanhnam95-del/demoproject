'use strict';
// Reloading the CRM on #projects must return an administrator to Projects.
// Administrator Projects access is learned in the background, after the
// initial route falls back to Staff; the start-up flow must re-apply the
// requested route once access is confirmed, and never keep another user's flag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../../public/crm-admin.js'), 'utf8');
const init = source.slice(source.indexOf('  async function init() {'), source.indexOf('\n  }\n', source.indexOf('    applyRouteFromHash({ initial: true });')));

test('initial #projects request is captured before any route rewrite', () => {
    const capture = init.indexOf("const initialHash = window.location.hash || '';");
    assert.ok(capture > 0);
    assert.ok(capture < init.indexOf('applyRouteFromHash({ initial: true });'));
    assert.match(init, /initialRequestsProjects = normalizeRouteToken\(initialHash/);
});

test('background access confirmation re-applies the original Projects route', () => {
    const background = init.slice(init.indexOf('fetchProjectsAccessSummary(user).then('), init.indexOf('}).catch((err) => {'));
    assert.match(background, /state\.projectsEnabled = /);
    assert.ok(background.indexOf('reconcileProjectsRoute();') > background.indexOf('state.projectsEnabled = '));
    assert.match(background, /cur\.projectsEnabled = state\.projectsEnabled;/);
    const reconcile = init.slice(init.indexOf('const reconcileProjectsRoute = () => {'), init.indexOf('};', init.indexOf('const reconcileProjectsRoute = () => {')));
    // Only when the person has not navigated away since the fallback route.
    assert.match(reconcile, /window\.location\.hash === hashAfterInitialRoute/);
    assert.match(reconcile, /window\.history\.replaceState\(null, '', initialHash\)/);
    assert.match(reconcile, /applyRouteFromHash\(\);\s*render\(\);/);
    // Access that turns out to be off leaves Projects again.
    assert.match(reconcile, /!state\.projectsEnabled && state\.main === 'projects'/);
});

test('the initial route marks itself applied and reconciles an earlier confirmation', () => {
    const tail = init.slice(init.indexOf('applyRouteFromHash({ initial: true });'));
    assert.match(tail, /render\(\);\s*initialRouteApplied = true;\s*hashAfterInitialRoute = window\.location\.hash;\s*reconcileProjectsRoute\(\);/);
});

test('a cached Projects flag is used only for the same administrator', () => {
    assert.match(init, /state\.accessMode === 'admin' && warmCached\.projectsEnabled === true/);
    const mismatch = init.slice(init.indexOf('warmCached.uid !== user.uid'), init.indexOf('warmCached.uid !== user.uid') + 200);
    assert.match(mismatch, /state\.projectsEnabled = false;/);
    assert.match(init, /projectsEnabled: warmCached\?\.uid === user\.uid && warmCached\?\.projectsEnabled === true/);
});

test('a non-dashboard reload does not flash the Dashboard panel', () => {
    assert.match(init, /document\.querySelector\('\[data-panel="dashboard"\]'\)\?\.style\.setProperty\('display', 'none', 'important'\)/);
});
