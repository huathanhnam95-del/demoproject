// Simple script to help set up HTTPS
// This will guide you through creating certificates

const fs = require('fs');
const { execSync } = require('child_process');

console.log('Setting up HTTPS for localhost...\n');

// Check if certificates already exist
if (fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  console.log('Certificates already exist!');
  console.log('Run: npm start');
  process.exit(0);
}

console.log('To create SSL certificates, you have a few options:\n');
console.log('Option 1: Using OpenSSL (if installed):');
console.log('  openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"');
console.log('\nOption 2: Using mkcert (recommended for easier setup):');
console.log('  1. Install mkcert: https://github.com/FiloSottile/mkcert');
console.log('  2. Run: mkcert -install');
console.log('  3. Run: mkcert localhost');
console.log('  4. Rename the generated files to cert.pem and key.pem');
console.log('\nOption 3: Use the simple server.js (no certificates needed, but browser will show warning)');
console.log('  node server.js');

