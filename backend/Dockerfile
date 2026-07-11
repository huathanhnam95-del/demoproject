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
COPY public/cmudict.json ./local_server/cmudict.json

# Cloud Run uses PORT env variable
ENV PORT=8080
EXPOSE 8080

# Run with gunicorn
CMD ["sh", "-c", "exec gunicorn --bind :${PORT} --workers 1 --threads 8 --timeout 60 local_server.server:app"]
