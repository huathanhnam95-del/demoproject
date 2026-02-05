const sendError = (res, status, error, message, details = null) => {
    return res.status(status).json({
        success: false,
        error,
        message,
        ...(details && { details })
    });
};

const sendSuccess = (res, data, message = null) => {
    return res.json({
        success: true,
        ...(message && { message }),
        ...data
    });
};

module.exports = { sendError, sendSuccess };
