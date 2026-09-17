'use strict';
/* Run against an explicitly selected development/staging URL. This script never
 * submits an answer. Install the repository's pinned Playwright dependencies first. */
const fs = require('node:fs/promises');
const path = require('node:path');
function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}
async function main() {
  const { chromium } = require('playwright');
  const target = process.argv[2];
  if (!target || target.startsWith('--')) throw new Error('Usage: node capture-baseline.cjs URL --ready=CSS_SELECTOR [--runs=5] [--sw=block|allow]');
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('An HTTP(S) URL is required.');
  const readySelector = option('ready', '');
  if (!readySelector) throw new Error('--ready is required; do not substitute networkidle for task readiness.');
  const runs = Number(option('runs', '5'));
  const cpu = Number(option('cpu', '4'));
  const sw = option('sw', 'block');
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 30 || !Number.isFinite(cpu) || cpu < 1 || cpu > 20) throw new Error('Invalid run count or CPU multiplier.');
  if (!['block', 'allow'].includes(sw)) throw new Error('--sw must be block or allow.');
  const output = path.resolve(option('out', 'test-results/performance/baseline.json'));
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: sw });
      try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
        let errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const visit of ['cold', 'warm']) {
          errors = [];
          const sample = { run, visit, status: 'ok' };
          try {
            if (visit === 'cold') await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
            else await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector(readySelector, { state: 'visible', timeout: 30000 });
            Object.assign(sample, await page.evaluate(() => ({
              observedReadyMs: performance.now(),
              tasks: window.BELPerf?.snapshot() || [],
              navigation: performance.getEntriesByType('navigation').map(entry => ({
                domContentLoadedMs: entry.domContentLoadedEventEnd,
                responseStartMs: entry.responseStart,
                transferSize: entry.transferSize
              })),
              resources: performance.getEntriesByType('resource').map(entry => {
                const parsed = new URL(entry.name);
                return { path: parsed.origin + parsed.pathname, initiator: entry.initiatorType,
                  startTime: entry.startTime, durationMs: entry.duration,
                  transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
                  decodedBodySize: entry.decodedBodySize };
              })
            })));
            if (errors.length) { sample.status = 'page-errors'; process.exitCode = 1; }
          } catch (error) {
            sample.status = 'failed'; sample.error = error.message; process.exitCode = 1;
          }
          sample.pageErrors = [...errors];
          samples.push(sample);
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({
    schemaVersion: 1, target: url.origin + url.pathname, cpuMultiplier: cpu,
    serviceWorkers: sw, networkThrottling: 'none', readySelector, samples,
    notes: [
      'Cold means new browser context; warm means reload in the same context.',
      'Observed readiness includes automation observation delay; BELPerf measures instrumented task boundaries.',
      'This is lab evidence, not field LCP/INP/CLS certification.',
      'Resource Timing zero bytes can mean cache or unavailable cross-origin timing data.',
      'The allow run does not prove the worker activated; inspect registration/controller state separately.',
      'Do not intercept requests in this throughput benchmark; routing can disable HTTP caching.'
    ]
  }, null, 2) + '\n');
  console.log(output);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
