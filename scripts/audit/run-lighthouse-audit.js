/**
 * Lighthouse runner for BEL onboarding audit.
 *
 * Produces HTML + JSON lighthouse reports for:
 * - Landing page
 * - App home
 *
 * Usage:
 *   node scripts/audit/run-lighthouse-audit.js --base-url https://localhost:8443
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');

function parseArgs(argv) {
  const args = {
    baseUrl: 'https://localhost:8443',
    outputDir: path.join('docs', 'audits', '2026-03-01-a2-vn-pte-onboarding', 'artifacts', 'perf'),
    startServer: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--no-server') {
      args.startServer = false;
      continue;
    }
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function fetchJson(url, timeoutMs = 10_000) {
  const isHttps = url.startsWith('https://');
  const lib = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const requestOptions = { timeout: timeoutMs };
    if (isHttps) {
      try {
        const hostname = new URL(url).hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          requestOptions.agent = new https.Agent({ rejectUnauthorized: false });
        }
      } catch {
        // ignore
      }
    }

    const req = lib.get(url, requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

async function waitForHealth(baseUrl, timeoutMs = 45_000) {
  const start = Date.now();
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchJson(healthUrl, 5_000);
      if (res.status === 200 && res.data && res.data.success === true) return true;
    } catch {
      // ignore
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Health check timed out: ${healthUrl}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startLocalServer() {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));
  return { child, getOutput: () => lines.join('') };
}

async function stopLocalServer(serverProc) {
  if (!serverProc || !serverProc.child || serverProc.child.killed) return;
  serverProc.child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  if (!serverProc.child.killed) serverProc.child.kill('SIGKILL');
}

function runCmd(cmd, args, { cwd, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env },
      windowsHide: true,
      shell: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`Command timeout after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code || 0, out, err });
    });
  });
}

function getNpxBin() {
  return 'npx';
}

function toRelPath(filePath) {
  return path.relative(process.cwd(), filePath);
}

function writeCmdLog(logPath, { cmd, args, code, out, err }) {
  const lines = [];
  lines.push(`[cmd] ${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`);
  lines.push(`[exit] ${code}`);
  lines.push('');
  lines.push('--- stdout ---');
  lines.push(out || '');
  lines.push('');
  lines.push('--- stderr ---');
  lines.push(err || '');
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = nowRunId();
  const outputDir = path.resolve(args.outputDir);
  ensureDir(outputDir);
  const perfThresholds = {
    landing_mobile: 0.7,
    app_mobile: 0.55
  };
  const perfFailures = [];

  const report = {
    runId,
    timestamp: new Date().toISOString(),
    baseUrl: args.baseUrl,
    startServer: args.startServer,
    results: []
  };

  const base = args.baseUrl.replace(/\/$/, '');
  const targets = [
    { id: 'landing_mobile', url: `${base}/landing/`, name: 'Landing (Mobile)' },
    { id: 'app_mobile', url: `${base}/index.html`, name: 'App Home (Mobile)' }
  ];

  const npxCmd = getNpxBin();
  const chromeFlags = '--ignore-certificate-errors --allow-insecure-localhost';

  let serverProc = null;
  try {
    if (args.startServer) {
      serverProc = startLocalServer();
      await waitForHealth(args.baseUrl, 60_000);
    }

    for (const t of targets) {
      const htmlPath = path.join(outputDir, `${runId}__${t.id}.html`);
      const jsonPath = path.join(outputDir, `${runId}__${t.id}.json`);
      const htmlLog = path.join(outputDir, `${runId}__${t.id}__html.log.txt`);
      const jsonLog = path.join(outputDir, `${runId}__${t.id}__json.log.txt`);

      const common = [
        t.url,
        '--form-factor=mobile',
        '--screenEmulation.mobile=true',
        '--screenEmulation.width=393',
        '--screenEmulation.height=851',
        '--screenEmulation.deviceScaleFactor=2.75',
        `--chrome-flags=${chromeFlags}`,
        '--quiet'
      ];

      // HTML
      const htmlArgs = ['lighthouse', ...common, '--output=html', `--output-path=${toRelPath(htmlPath)}`];
      const htmlRes = await runCmd(npxCmd, htmlArgs, {
        cwd: process.cwd(),
        timeoutMs: 6 * 60_000
      });
      try {
        writeCmdLog(htmlLog, { cmd: npxCmd, args: htmlArgs, ...htmlRes });
      } catch {
        // ignore
      }

      // JSON
      const jsonArgs = ['lighthouse', ...common, '--output=json', `--output-path=${toRelPath(jsonPath)}`];
      const jsonRes = await runCmd(npxCmd, jsonArgs, {
        cwd: process.cwd(),
        timeoutMs: 6 * 60_000
      });
      try {
        writeCmdLog(jsonLog, { cmd: npxCmd, args: jsonArgs, ...jsonRes });
      } catch {
        // ignore
      }

      let perfScore = null;
      try {
        const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
        const parsed = JSON.parse(jsonRaw);
        perfScore = parsed?.categories?.performance?.score ?? null;
        const minScore = perfThresholds[t.id];
        if (typeof minScore === 'number' && typeof perfScore === 'number' && perfScore < minScore) {
          perfFailures.push({
            id: t.id,
            name: t.name,
            score: perfScore,
            threshold: minScore
          });
        }
      } catch {
        // ignore
      }

      report.results.push({
        id: t.id,
        name: t.name,
        url: t.url,
        html: toRelPath(htmlPath),
        json: toRelPath(jsonPath),
        htmlLog: toRelPath(htmlLog),
        jsonLog: toRelPath(jsonLog),
        htmlExitCode: htmlRes.code,
        jsonExitCode: jsonRes.code,
        performanceScore: perfScore
      });
    }
  } finally {
    if (serverProc) {
      const serverLog = path.join(outputDir, `${runId}__local_server.lighthouse.log.txt`);
      try {
        fs.writeFileSync(serverLog, serverProc.getOutput(), 'utf8');
        report.localServerLog = toRelPath(serverLog);
      } catch {
        // ignore
      }
      await stopLocalServer(serverProc);
    }
  }

  const reportPath = path.join(outputDir, `${runId}__lighthouse-summary.json`);
  if (perfFailures.length > 0) {
    report.perfFailures = perfFailures;
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  if (perfFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[lighthouse] Performance thresholds failed:');
    for (const failure of perfFailures) {
      // eslint-disable-next-line no-console
      console.error(` - ${failure.id} (${failure.name}): ${failure.score} < ${failure.threshold}`);
    }
    process.exitCode = 2;
  }
  // eslint-disable-next-line no-console
  console.log(`[lighthouse] Done. Summary: ${reportPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
