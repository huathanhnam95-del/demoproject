const { GoogleGenAI } = require('@google/genai');

const DEFAULT_VERTEX_LOCATION = 'global';

const clientsByLocation = new Map();

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function getProjectId() {
  return normalizeScalar(process.env.GCLOUD_PROJECT)
    || normalizeScalar(process.env.FIREBASE_PROJECT_ID)
    || normalizeScalar(process.env.GCP_PROJECT)
    || normalizeScalar(process.env.GOOGLE_CLOUD_PROJECT);
}

function getGenAiClient(location = DEFAULT_VERTEX_LOCATION) {
  const project = getProjectId();
  if (!project) {
    throw new Error('Missing project ID for Vertex AI');
  }

  const safeLocation = normalizeScalar(location) || DEFAULT_VERTEX_LOCATION;
  const cacheKey = `${project}:${safeLocation}`;
  if (clientsByLocation.has(cacheKey)) {
    return clientsByLocation.get(cacheKey);
  }

  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location: safeLocation
  });
  clientsByLocation.set(cacheKey, client);
  return client;
}

function getGeminiModel({ modelName, location, generationConfig }) {
  const safeModelName = normalizeScalar(modelName);
  if (!safeModelName) {
    throw new Error('Missing Gemini model name');
  }

  const client = getGenAiClient(location);

  return {
    generateContent(contents) {
      return client.models.generateContent({
        model: safeModelName,
        contents,
        config: generationConfig && typeof generationConfig === 'object'
          ? generationConfig
          : undefined
      });
    }
  };
}

function shouldUseGeminiFallback(err) {
  const msg = String(err?.message || err || '');
  if (!msg) return false;
  const lower = msg.toLowerCase();

  return lower.includes('quota')
    || lower.includes('not found')
    || lower.includes('not supported')
    || lower.includes('unavailable')
    || msg.includes('[404')
    || msg.includes('[429')
    || msg.includes('[503');
}

module.exports = {
  DEFAULT_VERTEX_LOCATION,
  getGenAiClient,
  getGeminiModel,
  normalizeScalar,
  shouldUseGeminiFallback
};
