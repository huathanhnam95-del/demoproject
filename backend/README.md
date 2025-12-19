# Paraphrase Backend Server

This backend server provides keyword extraction and text paraphrasing functionality for the Extended Listening mode.

## Setup

1. **Install dependencies** (first time only):
   ```bash
   pip install -r requirements.txt
   ```
   
   Note: This will download ~500MB of AI models on first run. It may take 2-5 minutes.

2. **Start the server**:
   ```bash
   python app.py
   ```
   
   Or double-click `start-server.bat` on Windows.

3. **Verify it's running**:
   - You should see: "🚀 Server starting on http://localhost:5000"
   - The server will be available at `http://localhost:5000`

## API Endpoints

- `GET /` - Server status
- `GET /api/health` - Health check
- `POST /api/paraphrase` - Paraphrase text with keywords
  - Body: `{ "text": "Your text here" }`
  - Returns: `{ "success": true, "data": { "keywords": [...], "paraphrased_text": "...", ... } }`

## Troubleshooting

- **Port 5000 already in use**: Change the port in `app.py` (last line: `app.run(..., port=5001)`)
- **Models not loading**: Make sure you have internet connection for first-time model downloads
- **Memory errors**: Close other applications to free up RAM

## Notes

- The server must be running for the Keywords feature to work in Extended Listening mode
- First request may be slow as models load into memory
- Subsequent requests will be faster

