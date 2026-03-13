const rateLimit = require('express-rate-limit');

const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
        const retryAfterSeconds = Math.ceil(Number(options.windowMs || 60 * 1000) / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(options.statusCode).json({
            success: false,
            error: 'RATE_LIMITED',
            message: 'AI endpoint rate limit exceeded. Please wait.',
            retryAfterSeconds
        });
    }
});

module.exports = aiLimiter;
