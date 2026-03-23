function getModelName() {
    return process.env.READING_JOURNEY_THUMBNAIL_MODEL || 'imagen-3.0-generate-001';
}

function buildGeneratorPayload({ promptText, repairPromptDelta, referenceImages }) {
    let finalPrompt = promptText;
    if (repairPromptDelta) {
        finalPrompt += '\n\nMODIFICATION REQUIREMENT: ' + repairPromptDelta;
    }

    const payload = {
        instances: [
            { prompt: finalPrompt }
        ],
        parameters: {
            sampleCount: 1,
            aspectRatio: '16:9'
        }
    };

    if (referenceImages && referenceImages.length > 0) {
        payload.instances[0].referenceImages = referenceImages;
    }

    return payload;
}

async function generateThumbnailImage({ promptSpec, repairPromptDelta, referenceImages, attempt = 1 }) {
    if (process.env.READING_JOURNEY_THUMBNAILS_ENABLED === 'false') {
        throw new Error('Thumbnail generation is disabled');
    }

    const payload = buildGeneratorPayload({
        promptText: promptSpec.promptText,
        repairPromptDelta,
        referenceImages
    });

    const modelName = getModelName();

    if (process.env.NODE_ENV === 'test' || process.env.DRY_RUN) {
        return {
            model: modelName,
            attempt,
            imageBytes: Buffer.from('mock-bytes'),
            rawResponseMeta: { payload }
        };
    }

    // Example actual network request would go here
    return {
        model: modelName,
        attempt,
        imageBytes: Buffer.from('live-mock-bytes'),
        rawResponseMeta: { stub: true, payload }
    };
}

module.exports = {
    buildGeneratorPayload,
    generateThumbnailImage
};
