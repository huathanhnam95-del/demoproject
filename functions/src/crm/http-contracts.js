function buildSuccessPayload(data = {}, message = null) {
    return {
        success: true,
        ...(message ? { message } : {}),
        ...data
    };
}

function buildErrorPayload(error, message, details = null) {
    return {
        success: false,
        error,
        message,
        ...(details ? { details } : {})
    };
}

function sendSuccess(res, data = {}, message = null) {
    return res.json(buildSuccessPayload(data, message));
}

function sendError(res, status, error, message, details = null) {
    return res.status(status).json(buildErrorPayload(error, message, details));
}

module.exports = {
    buildSuccessPayload,
    buildErrorPayload,
    sendSuccess,
    sendError
};
