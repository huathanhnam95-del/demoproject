# Quick Start: HTTPS Server Setup

## Easiest Method: Using mkcert (Recommended)

1. **Download mkcert**:
   - Go to: https://github.com/FiloSottile/mkcert/releases
   - Download `mkcert-v1.4.4-windows-amd64.exe` (or latest version)
   - Rename it to `mkcert.exe` and place it in your project folder

2. **Install mkcert** (one-time):
   ```cmd
   mkcert -install
   ```

3. **Create certificates**:
   ```cmd
   mkcert localhost
   ```
   This creates `localhost.pem` and `localhost-key.pem`

4. **Rename the files**:
   ```cmd
   ren localhost.pem cert.pem
   ren localhost-key.pem key.pem
   ```

5. **Start the server**:
   - If you have Python: `python server.py`
   - If you have Node.js: `npm install && npm start`
   - Or use the batch file: `start-https.bat`

6. **Open in browser**: https://localhost:8443/
   - Click "Advanced" → "Proceed to localhost" when you see the security warning

## Alternative: Using OpenSSL (if you have Git Bash)

1. Open Git Bash in your project folder
2. Run:
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
   ```
3. Start the server (Python or Node.js)

## Why HTTPS?

Browsers require HTTPS for microphone access. This setup allows your dictation app to work properly with speech recognition!

