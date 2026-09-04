const express = require('express');
const path = require('path');
const app = express();
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.listen(8000, '0.0.0.0', () => {
  console.log('[HTTP] Demo server running on http://localhost:8000');
});
