// @ts-check
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, '..', 'public');

app.get('/api/config', (_req, res) => {
  res.json({
    success: true,
    config: {},
    features: { echoForgeSandbox: true },
  });
});

app.use(express.static(publicDir));

const server = http.createServer(app);
server.listen(port, '0.0.0.0', () => {
  console.log(`[Echo Forge] Server active at http://localhost:${port}`);
  console.log(`[Echo Forge] Direct arena: http://localhost:${port}/echo-forge-sandbox.html`);
  console.log(`[Echo Forge] Dashboard: http://localhost:${port}/`);
});
