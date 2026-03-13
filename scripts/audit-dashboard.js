#!/usr/bin/env node
/**
 * Live Audit Dashboard — serves a real-time progress page for the audit script.
 * Reads progress.json written by audit-reading-journey-stories.js and serves
 * a beautiful dashboard at http://localhost:3737
 *
 * Usage:  node scripts/audit-dashboard.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3737;
const PROGRESS_FILE = path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', 'progress.json');

function readProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>📊 Story Audit Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0e1a;
    --card: rgba(255,255,255,0.04);
    --card-border: rgba(255,255,255,0.08);
    --text: #e2e8f0;
    --text-dim: #64748b;
    --accent: #6366f1;
    --accent-glow: rgba(99,102,241,0.3);
    --green: #22c55e;
    --green-glow: rgba(34,197,94,0.2);
    --red: #ef4444;
    --red-glow: rgba(239,68,68,0.2);
    --amber: #f59e0b;
    --amber-glow: rgba(245,158,11,0.2);
    --radius: 16px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }
  /* Animated background */
  body::before {
    content: '';
    position: fixed;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(ellipse at 30% 20%, rgba(99,102,241,0.08) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 80%, rgba(34,197,94,0.05) 0%, transparent 50%);
    animation: bgShift 20s ease-in-out infinite alternate;
    z-index: -1;
  }
  @keyframes bgShift {
    0% { transform: translate(0, 0); }
    100% { transform: translate(-5%, -3%); }
  }

  .container { max-width: 1200px; margin: 0 auto; padding: 24px 20px; }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--card-border);
  }
  .header h1 {
    font-size: 28px;
    font-weight: 800;
    background: linear-gradient(135deg, #6366f1, #a78bfa, #22c55e);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -0.5px;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 100px;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .status-running {
    background: var(--accent-glow);
    color: #a5b4fc;
    border: 1px solid rgba(99,102,241,0.3);
  }
  .status-done {
    background: var(--green-glow);
    color: #86efac;
    border: 1px solid rgba(34,197,94,0.3);
  }
  .status-waiting {
    background: var(--amber-glow);
    color: #fbbf24;
    border: 1px solid rgba(245,158,11,0.3);
  }
  .pulse {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .status-running .pulse { background: #818cf8; }
  .status-done .pulse { background: var(--green); animation: none; }
  .status-waiting .pulse { background: var(--amber); }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  /* Stats Row */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;
    margin-bottom: 28px;
  }
  .stat-card {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 20px;
    text-align: center;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  .stat-value {
    font-size: 36px;
    font-weight: 800;
    line-height: 1.1;
    margin-bottom: 4px;
  }
  .stat-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.amber .stat-value { color: var(--amber); }
  .stat-card.accent .stat-value { color: #a78bfa; }

  /* Progress Section */
  .progress-section {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 28px;
  }
  .progress-section h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .current-info {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .current-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text);
  }
  .current-level {
    padding: 4px 12px;
    border-radius: 100px;
    font-size: 12px;
    font-weight: 700;
    background: var(--accent-glow);
    color: #a5b4fc;
    border: 1px solid rgba(99,102,241,0.3);
  }
  .progress-bar-container {
    background: rgba(255,255,255,0.06);
    border-radius: 12px;
    height: 24px;
    position: relative;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .progress-bar-fill {
    height: 100%;
    border-radius: 12px;
    background: linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa);
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    min-width: 2px;
  }
  .progress-bar-fill::after {
    content: '';
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 80px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15));
    animation: shimmer 2s ease-in-out infinite;
  }
  @keyframes shimmer {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }
  .progress-label {
    font-size: 13px;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
  }

  /* Outline Progress Bar (batch) */
  .outline-bar-container {
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
    height: 12px;
    overflow: hidden;
    margin-top: 12px;
    margin-bottom: 4px;
  }
  .outline-bar-fill {
    height: 100%;
    border-radius: 8px;
    background: linear-gradient(90deg, #22c55e, #4ade80);
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .outline-label {
    font-size: 12px;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
  }

  /* Completed Outlines Table */
  .table-section {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 28px;
    overflow-x: auto;
  }
  .table-section h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 4px;
  }
  th {
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 8px 12px;
  }
  td {
    padding: 12px;
    font-size: 14px;
    background: rgba(255,255,255,0.02);
  }
  tr td:first-child { border-radius: 8px 0 0 8px; }
  tr td:last-child { border-radius: 0 8px 8px 0; }
  .score-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    min-width: 48px;
    text-align: center;
  }
  .score-pass { background: var(--green-glow); color: #86efac; }
  .score-fail { background: var(--red-glow); color: #fca5a5; }
  .score-warn { background: var(--amber-glow); color: #fbbf24; }

  /* Recent Paths Feed */
  .feed-section {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 28px;
  }
  .feed-section h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .feed-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 13px;
    animation: slideIn 0.3s ease-out;
  }
  .feed-item:last-child { border-bottom: none; }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .feed-icon { font-size: 16px; flex-shrink: 0; }
  .feed-path {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    color: #94a3b8;
    font-size: 12px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .feed-outline {
    color: var(--text-dim);
    font-size: 11px;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .feed-criticals {
    font-size: 11px;
    color: var(--red);
    opacity: 0.8;
  }

  /* Timer */
  .timer {
    font-size: 13px;
    color: var(--text-dim);
    text-align: right;
  }
  .timer span { color: var(--text); font-weight: 600; }

  /* No data state */
  .no-data {
    text-align: center;
    padding: 80px 20px;
    color: var(--text-dim);
  }
  .no-data-icon { font-size: 48px; margin-bottom: 16px; }
  .no-data h2 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: var(--text); }
  .no-data p { font-size: 14px; }

  /* ETA */
  .eta-bar {
    display: flex;
    gap: 24px;
    align-items: center;
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }
  .eta-bar span { color: var(--text); font-weight: 500; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📊 Story Audit Dashboard</h1>
    <div id="statusBadge" class="status-badge status-waiting">
      <div class="pulse"></div>
      <span id="statusText">Waiting for data</span>
    </div>
  </div>
  <div id="content">
    <div class="no-data">
      <div class="no-data-icon">⏳</div>
      <h2>Waiting for audit data...</h2>
      <p>Start the audit script and this dashboard will update automatically.</p>
    </div>
  </div>
</div>

<script>
const POLL_MS = 2000;
let lastJson = '';

function fmt(ms) {
  if (!ms || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

function scoreBadge(score) {
  const cls = score >= 7 ? 'score-pass' : score >= 5 ? 'score-warn' : 'score-fail';
  return '<span class="score-badge ' + cls + '">' + score.toFixed(1) + '</span>';
}

function render(d) {
  if (!d) return;
  const total = d.totals.passed + d.totals.failed + d.totals.errors;
  const passRate = total > 0 ? ((d.totals.passed / total) * 100).toFixed(1) : '0.0';
  const elapsed = d.updatedAt - d.startedAt;
  const isDone = d.status === 'done';

  // Estimate ETA
  const completedPaths = total;
  const totalEstPaths = d.batch.limit * 27; // ~27 paths per outline avg
  const pathsRemaining = Math.max(0, totalEstPaths - completedPaths);
  const msPerPath = completedPaths > 0 ? elapsed / completedPaths : 30000;
  const etaMs = pathsRemaining * msPerPath;

  // Status badge
  const badge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  badge.className = 'status-badge ' + (isDone ? 'status-done' : 'status-running');
  statusText.textContent = isDone ? 'Audit Complete' : 'Running…';

  // Current outline progress
  const pathPct = d.current.totalPaths > 0
    ? Math.round((d.current.pathIndex / d.current.totalPaths) * 100) : 0;
  const outlinePct = d.batch.limit > 0
    ? Math.round(((d.current.outlineIndex - 1 + pathPct / 100) / d.batch.limit) * 100) : 0;

  let html = '';

  // Stats Row
  html += '<div class="stats-row">';
  html += '<div class="stat-card accent"><div class="stat-value">' + total + '</div><div class="stat-label">Total Assessed</div></div>';
  html += '<div class="stat-card green"><div class="stat-value">' + d.totals.passed + '</div><div class="stat-label">Passed (≥7.0)</div></div>';
  html += '<div class="stat-card red"><div class="stat-value">' + d.totals.failed + '</div><div class="stat-label">Failed</div></div>';
  html += '<div class="stat-card amber"><div class="stat-value">' + passRate + '%</div><div class="stat-label">Pass Rate</div></div>';
  html += '<div class="stat-card"><div class="stat-value" style="color:var(--text)">' + d.completedOutlines.length + '/' + d.batch.limit + '</div><div class="stat-label">Outlines Done</div></div>';
  html += '<div class="stat-card"><div class="stat-value" style="color:var(--text)">' + fmt(elapsed) + '</div><div class="stat-label">Elapsed</div></div>';
  html += '</div>';

  // Current Outline Progress
  if (!isDone && d.current.outlineTitle) {
    html += '<div class="progress-section">';
    html += '<h2>Current Outline</h2>';
    html += '<div class="current-info">';
    html += '<span class="current-title">' + d.current.outlineTitle + '</span>';
    html += '<span class="current-level">' + d.current.outlineLevel + '</span>';
    html += '<span style="color:var(--text-dim);font-size:13px">Outline ' + d.current.outlineIndex + ' of ' + d.batch.limit + '</span>';
    html += '</div>';
    html += '<div class="progress-bar-container"><div class="progress-bar-fill" style="width:' + pathPct + '%"></div></div>';
    html += '<div class="progress-label"><span>Path ' + d.current.pathIndex + ' / ' + d.current.totalPaths + '</span><span>' + pathPct + '%</span></div>';
    // Batch progress bar
    html += '<div class="outline-bar-container"><div class="outline-bar-fill" style="width:' + outlinePct + '%"></div></div>';
    html += '<div class="outline-label"><span>Batch Progress</span><span>' + outlinePct + '%</span></div>';
    html += '<div class="eta-bar">';
    html += '<div>⏱ Elapsed: <span>' + fmt(elapsed) + '</span></div>';
    html += '<div>🔮 ETA: <span>' + fmt(etaMs) + '</span></div>';
    html += '<div>📡 Model: <span>' + (d.model || '—') + '</span></div>';
    html += '</div>';
    html += '</div>';
  } else if (isDone) {
    const duration = d.finishedAt - d.startedAt;
    html += '<div class="progress-section">';
    html += '<h2>✅ Audit Complete</h2>';
    html += '<div class="progress-bar-container"><div class="progress-bar-fill" style="width:100%;background:linear-gradient(90deg, #22c55e, #4ade80)"></div></div>';
    html += '<div class="eta-bar">';
    html += '<div>⏱ Total time: <span>' + fmt(duration) + '</span></div>';
    html += '<div>📡 Model: <span>' + (d.model || '—') + '</span></div>';
    html += '</div>';
    html += '</div>';
  }

  // Completed Outlines Table
  if (d.completedOutlines.length > 0) {
    html += '<div class="table-section">';
    html += '<h2>Completed Outlines (' + d.completedOutlines.length + ')</h2>';
    html += '<table><thead><tr><th>#</th><th>Title</th><th>Level</th><th>Paths</th><th>Best</th><th>Worst</th><th>Status</th></tr></thead><tbody>';
    d.completedOutlines.forEach(function(o, idx) {
      const st = o.allPassed ? '<span style="color:var(--green)">✅ All Pass</span>' : '<span style="color:var(--red)">❌ Has Fails</span>';
      html += '<tr>';
      html += '<td>' + (idx + 1) + '</td>';
      html += '<td style="font-weight:500">' + o.title + '</td>';
      html += '<td>' + o.level + '</td>';
      html += '<td>' + o.pathCount + '</td>';
      html += '<td>' + scoreBadge(o.bestAvg) + '</td>';
      html += '<td>' + scoreBadge(o.worstAvg) + '</td>';
      html += '<td>' + st + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // Recent Paths Feed
  if (d.recentPaths && d.recentPaths.length > 0) {
    html += '<div class="feed-section">';
    html += '<h2>Recent Assessments</h2>';
    d.recentPaths.slice(0, 15).forEach(function(p) {
      const icon = p.passed ? '✅' : '❌';
      const critText = p.criticals && p.criticals.length ? ' · ' + p.criticals.join(', ') : '';
      html += '<div class="feed-item">';
      html += '<span class="feed-icon">' + icon + '</span>';
      html += '<span class="feed-path">' + p.pathLabel + '</span>';
      html += scoreBadge(p.score);
      html += '<span class="feed-outline">' + p.outline + '</span>';
      if (critText) html += '<span class="feed-criticals">' + critText + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  document.getElementById('content').innerHTML = html;
}

async function poll() {
  try {
    const res = await fetch('/api/progress');
    if (res.ok) {
      const text = await res.text();
      if (text !== lastJson) {
        lastJson = text;
        render(JSON.parse(text));
      }
    }
  } catch(_) {}
  setTimeout(poll, POLL_MS);
}

poll();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/progress') {
    const data = readProgress();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data ? JSON.stringify(data) : '{}');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
  }
});

server.listen(PORT, () => {
  console.log(`\n  📊 Audit Dashboard running at:  http://localhost:${PORT}\n`);
  console.log(`  Watching: ${PROGRESS_FILE}\n`);
});
