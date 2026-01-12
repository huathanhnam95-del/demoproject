FROM python:3.10-slim

WORKDIR /app

# Install system dependencies for Parselmouth
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server.py .

# Cloud Run uses PORT env variable
ENV PORT=8080
EXPOSE 8080

# Run with gunicorn
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 60 server:app