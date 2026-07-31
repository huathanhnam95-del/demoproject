---
name: python-backend
description: Python Flask/FastAPI backend patterns for audio processing APIs. Use when working with server code, API endpoints, Docker deployment, or Cloud Run configuration.
---

# Python Backend Skill

This skill covers **backend development** for the pronunciation analysis API including Flask setup, audio processing, and Cloud Run deployment.

## Project Structure

```text
backend/
├── server.py          # Main Flask app
├── requirements.txt   # Dependencies
├── Dockerfile         # Container config
├── *.praat           # Analysis scripts
└── test_*.py         # Test files
```

---

## API Endpoint Pattern

```python
from flask import Flask, request, jsonify
from flask_cors import CORS
import parselmouth

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/analyze', methods=['POST'])
def analyze_audio():
    try:
        # Get audio file
        audio_file = request.files.get('audio')
        expected_syllables = request.form.get('expected_syllables', type=int)
        
        # Save temporarily
        temp_path = '/tmp/audio.wav'
        audio_file.save(temp_path)
        
        # Process with Praat
        result = process_audio(temp_path, expected_syllables)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
```

---

## Audio Processing Pattern

```python
import parselmouth
from parselmouth.praat import call
import numpy as np

def process_audio(audio_path, expected_syllables=None):
    sound = parselmouth.Sound(audio_path)
    
    # Extract features
    pitch = sound.to_pitch()
    intensity = sound.to_intensity()
    
    # Detect syllables
    syllables = detect_syllables(sound, intensity)
    
    # Prune if expected count provided
    if expected_syllables and len(syllables) > expected_syllables:
        syllables = prune_syllables_to_expected(syllables, expected_syllables)
    
    # Build response
    return {
        'syllables': syllables,
        'duration': sound.duration,
        'pitchData': extract_pitch_data(pitch),
    }
```

---

## Dockerfile for Cloud Run

```dockerfile
FROM python:3.11-slim

# Install Praat dependencies
RUN apt-get update && apt-get install -y \
    praat \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run uses PORT env variable
ENV PORT=8080
EXPOSE 8080

CMD ["python", "server.py"]
```

---

## Requirements

```text
flask>=2.0
flask-cors>=4.0
parselmouth>=0.4
numpy>=1.24
gunicorn>=21.0
```

---

## Environment Variables

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `PORT` | Server port | `8080` |
| `DEBUG` | Debug mode | `false` |
| `ALLOWED_ORIGINS` | CORS origins | `*` |

---

## Common Issues & Solutions

### Issue: Praat not found in Docker

**Fix**: Install `praat` package: `apt-get install praat`

### Issue: Audio conversion errors

**Fix**: Ensure `libsndfile1` is installed for format support

### Issue: CORS errors

**Fix**: Use `flask-cors` with proper origin configuration

### Issue: Memory errors with large files

**Fix**: Limit file size, use streaming, or increase Cloud Run memory

---

## Testing Commands

```bash
# Run locally
python server.py

# Test endpoint
curl -X POST -F "audio=@test.wav" http://localhost:8080/analyze

# Build Docker image
docker build -t pronunciation-api .

# Run container
docker run -p 8080:8080 pronunciation-api

# Deploy to Cloud Run
gcloud run deploy pronunciation-api --source .
```

---

## Debugging Checklist

- [ ] Check `requirements.txt` has all dependencies
- [ ] Verify audio file format (WAV, 16kHz+, mono)
- [ ] Test locally before deploying
- [ ] Check Cloud Run logs for errors
- [ ] Validate JSON response structure
