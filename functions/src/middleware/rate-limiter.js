const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 requests per window
    message: {
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // Cloud Functions runs behind Google's proxy — skip X-Forwarded-For validation
});

module.exports = aiLimiter;
