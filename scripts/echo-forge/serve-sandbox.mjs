// Minimal static server for local Echo Forge sandbox verification.
import express from 'express';
import path from 'node:path';

const app = express();
app.get('/api/config', (_req, res) => res.json({
  success: true, config: {}, features: { echoForgeSandbox: true },
}));
app.use(express.static(path.join(process.cwd(), 'public')));
app.listen(4178, '127.0.0.1', () => console.log('echo-forge sandbox on http://127.0.0.1:4178'));
