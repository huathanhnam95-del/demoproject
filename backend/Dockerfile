FROM python:3.10-slim

# Embed the source commit in the image, matching Dockerfile.phoneme. A tag named
# after a SHA is not enough: BUILD_SHA/GIT_SHA can also be set as service-level
# environment variables, which OVERRIDE the image and made /health report a
# stale commit after an otherwise correct deploy. Baking it here means the image
# always knows its own provenance.
ARG GIT_SHA="unknown"
ENV BUILD_SHA=${GIT_SHA}
ENV GIT_SHA=${GIT_SHA}

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
COPY backend/local_server/pitch_processing.py ./local_server/pitch_processing.py
COPY backend/local_server/phoneme_client.py ./local_server/phoneme_client.py
COPY backend/local_server/pronunciation_verifier.py ./local_server/pronunciation_verifier.py
# V4.2 server routes import these modules through the backend package. Keep
# their package layout, rather than relying on the workstation's source tree.
RUN mkdir -p ./backend/local_server ./backend/phoneme_service
COPY backend/__init__.py ./backend/__init__.py
COPY backend/local_server/__init__.py ./backend/local_server/__init__.py
COPY backend/local_server/pronounce_v42.py ./backend/local_server/pronounce_v42.py
COPY backend/local_server/segment_contract.py ./backend/local_server/segment_contract.py
COPY backend/local_server/stress_evaluator_v2.py ./backend/local_server/stress_evaluator_v2.py
COPY backend/local_server/stress_features_v2.py ./backend/local_server/stress_features_v2.py
COPY backend/phoneme_service/__init__.py ./backend/phoneme_service/__init__.py
COPY backend/phoneme_service/boundary_refinement.py ./backend/phoneme_service/boundary_refinement.py
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
