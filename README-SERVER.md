# Running the App on HTTPS Localhost

To serve your dictation app over HTTPS (which is required for microphone access in most browsers), you have several options:

## Option 1: Using Python (Easiest - if Python is installed)

1. **Create SSL certificates** (one-time setup):
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
   ```
   
   If you don't have OpenSSL, you can use **mkcert** (recommended):
   - Download from: https://github.com/FiloSottile/mkcert/releases
   - Install: `mkcert -install`
   - Create certificates: `mkcert localhost`
   - Rename the files to `cert.pem` and `key.pem`

2. **Start the server**:
   ```bash
   python server.py
   ```

3. **Open in browser**: https://localhost:8443/

## Option 2: Using Node.js (if Node.js is installed)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Create SSL certificates** (if not already created):
   ```bash
   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
   ```

3. **Start the server**:
   ```bash
   npm start
   ```
   Or:
   ```bash
   node server.js
   ```

4. **Open in browser**: https://localhost:8443/

## Option 3: Using http-server (Node.js package)

1. **Install http-server globally**:
   ```bash
   npm install -g http-server
   ```

2. **Create SSL certificates** (see Option 1)

3. **Start the server**:
   ```bash
   http-server -S -p 8443 -C cert.pem -K key.pem
   ```

4. **Open in browser**: https://localhost:8443/

## Browser Security Warning

When you first visit the site, your browser will show a security warning because the certificate is self-signed. This is normal for local development:

1. Click **"Advanced"** or **"Show Details"**
2. Click **"Proceed to localhost"** or **"Accept the Risk and Continue"**

## Why HTTPS?

Modern browsers require HTTPS for microphone access when not using `file://` URLs. Serving over HTTPS ensures:
- Microphone permissions work properly
- No repeated permission prompts
- Better security for local development

