# Project Configuration

## Structure

- **Root**: `c:\Cursor AI`
- **Source**: `.`
- **Conductor**: `conductor/`
- **Brain**: `.gemini/antigravity/brain/`

## Workflows

- **Sync**: Manual via `conductor/` files.
- **Agent**: Antigravity (Google Deepmind).

## Development Server

- **Local URL**: `https://localhost:8443` — **ALWAYS HTTPS, ALWAYS port 8443**
- **Start**: `node server.js` from project root
- **HTTPS**: Uses trusted CA certs (`localhost.pem` / `localhost-key.pem`)
- **NEVER use HTTP or port 3000**
