const https = require('https');
const fs = require('fs');
const path = require('path');

// Try to load certificates, but create a simple server even without them
let options = {};
let useHTTPS = false;

if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
  };
  useHTTPS = true;
} else if (fs.existsSync('localhost-key.pem') && fs.existsSync('localhost.pem')) {
  options = {
    key: fs.readFileSync('localhost-key.pem'),
    cert: fs.readFileSync('localhost.pem')
  };
  useHTTPS = true;
}

if (!useHTTPS) {
  console.log('No SSL certificates found. Creating a simple HTTP server instead.');
  console.log('For HTTPS, create certificates first (see setup-https.js)');
  const http = require('http');
  const server = http.createServer((req, res) => {
    serveFile(req, res);
  });
  server.listen(8080, () => {
    console.log('Server running at http://localhost:8080/');
  });
} else {
  https.createServer(options, (req, res) => {
    serveFile(req, res);
  }).listen(8443, () => {
    console.log('Server running at https://localhost:8443/');
    console.log('Note: Your browser will show a security warning for the self-signed certificate.');
    console.log('Click "Advanced" and then "Proceed to localhost" to continue.');
  });
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

function serveFile(req, res) {
  console.log(`${req.method} ${req.url}`);

  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
}
