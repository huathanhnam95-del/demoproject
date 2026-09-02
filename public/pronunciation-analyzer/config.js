/**
 * Pronunciation Analyzer Configuration
 * Centralized configuration for backend URL and feature flags
 */

// Keep one switch for local development. When true or default, localhost/127.0.0.1
// uses the deployed Cloud Run Praat HTTPS backend to avoid local 8081 TLS mismatch.
const FORCE_CLOUD_RUN = true;

export const config = {
    // Backend URL - Cloud Run (set to true only when local development must
    // exercise the deployed backend explicitly)
    forceCloudRun: FORCE_CLOUD_RUN,

    backendUrl: (() => {
        const cloudRunUrl = 'https://praat-api-1071929245506.us-central1.run.app';

        if (FORCE_CLOUD_RUN) {
            return cloudRunUrl;
        }

        // For local development, set forceCloudRun to false
        if (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') {
            // Use local backend for testing on the SAME origin
            return `${window.location.protocol}//${window.location.hostname}:8081`;
        }
        return cloudRunUrl;
    })(),

    // Firestore Collection Names
    wordReferencesCollection: 'word_references',

    // Feature Flags
    features: {
        useNativeReference: true,
        showComparison: true,
        showPronunciationVersionComparison: true,
        saveToDatabase: true,
        usePraatBackend: true,
        usePronunciationV3LearnerAnalysis: false,
        useGeneratedPronunciationReferenceAudio: false
    },

    // Cache Settings
    sessionCacheEnabled: true,

    // AI Pronunciation Feedback Endpoint (Backend Proxy with Vertex AI)
    aiSummaryEndpoint: '/api/pronunciation-ai/summary'
};
