FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for Parselmouth
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Build from the repository root so the image contents match the tested source tree.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Package only the canonical pronunciation runtime modules.
RUN mkdir -p ./local_server
COPY backend/local_server/__init__.py ./local_server/__init__.py
COPY backend/local_server/server.py ./local_server/server.py
COPY backend/local_server/pronunciation_reference.py ./local_server/pronunciation_reference.py
COPY backend/local_server/phoneme_client.py ./local_server/phoneme_client.py
COPY backend/local_server/pronunciation_verifier.py ./local_server/pronunciation_verifier.py
RUN mkdir -p ./local_server/models
COPY backend/local_server/models/pronunciation-verifier-v1.json ./local_server/models/pronunciation-verifier-v1.json
COPY public/cmudict.json ./local_server/cmudict.json

# Cloud Run uses PORT env variable
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

# Run with gunicorn
# --timeout must clear _V3_HARD_TIMEOUT_SECONDS (80s) in local_server/server.py.
# A V3 comparison waits on the phoneme recognizer, whose scale-to-zero cold
# start is ~50s; at 60s this worker was killed mid-wait and the browser saw a
# 504 even though every downstream budget had been widened.
CMD ["sh", "-c", "exec gunicorn --bind :${PORT} --workers 1 --threads 8 --timeout 120 local_server.server:app"]
