/**
 * Pronunciation Analyzer Configuration
 * Centralized configuration for backend URL and feature flags
 */

export const config = {
    // Backend URL - Cloud Run (set to false to use localhost for local dev)
    forceCloudRun: true,

    backendUrl: (() => {
        // Always use Cloud Run if forceCloudRun is true
        const cloudRunUrl = 'https://parselmouth-backend-1071929245506.us-central1.run.app';

        // For local development, set forceCloudRun to false
        if (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') {
            // Check if we should use local backend
            // return 'http://localhost:8080';  // Uncomment to use local backend
        }
        return cloudRunUrl;
    })(),

    // Firestore Collection Names
    wordReferencesCollection: 'word_references',

    // Feature Flags
    features: {
        useNativeReference: true,
        showComparison: true,
        saveToDatabase: true,
        usePraatBackend: true
    },

    // Cache Settings
    sessionCacheEnabled: true
};
