const express = require('express');
const router = express.Router();
const path = require('path');
const rateLimit = require('express-rate-limit');
const { db } = require('../utils/firebase');
const { sendError, sendSuccess } = require('../utils/response-helper');
const authMiddleware = require('../middleware/auth');

// --- Tight Rate Limiter for Admin Actions ---
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 attempts per IP
    message: {
        success: false,
        error: 'TOO_MANY_ADMIN_REQUESTS',
        message: 'Too many admin requests. Please try again later.'
    }
});

// --- Middleware: Concurrency Lock ---
let isSyncing = false;
const syncLockMiddleware = (req, res, next) => {
    if (isSyncing) {
        return sendError(res, 429, 'SYNC_IN_PROGRESS', 'A database synchronization is already in progress.');
    }
    next();
};

router.post('/sync-database', adminLimiter, authMiddleware, syncLockMiddleware, async (req, res) => {
    const { type } = req.body;

    if (!['watch', 'notes'].includes(type)) {
        return sendError(res, 400, 'INVALID_TYPE', 'Sync type must be "watch" or "notes".');
    }

    if (!db) {
        return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
    }

    isSyncing = true;
    try {
        // Lazy load ExcelJS only when needed
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();

        if (type === 'watch') {
            const filePath = path.join(process.cwd(), 'public', 'database', 'watch', 'Videos.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = db.batch();
            let count = 0;

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const videoId = row.getCell(1).value;
                const title = row.getCell(2).value;
                const level = row.getCell(3).value;
                const url = row.getCell(5).value;

                if (videoId && url) {
                    const videoRef = db.collection('watchVideos').doc(String(videoId));
                    batch.set(videoRef, {
                        id: String(videoId),
                        title: title || 'Untitled Video',
                        level: level || 'Beginner',
                        url: url,
                        updatedAt: new Date(),
                        syncedFromExcel: true
                    }, { merge: true });
                    count++;
                }
            });
            await batch.commit();
            return sendSuccess(res, { count }, `Synced ${count} videos.`);

        } else if (type === 'notes') {
            const filePath = path.join(process.cwd(), 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = db.batch();
            let count = 0;

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const id = row.getCell(1).value;
                const transcript = row.getCell(2).value;
                const videoUrl = row.getCell(3).value;

                if (id) {
                    const entryRef = db.collection('takeNotesEntries').doc(String(id));
                    batch.set(entryRef, {
                        id: String(id),
                        transcript: transcript || '',
                        videoUrl: videoUrl || '',
                        updatedAt: new Date(),
                        syncedFromExcel: true
                    }, { merge: true });
                    count++;
                }
            });
            await batch.commit();
            return sendSuccess(res, { count }, `Synced ${count} notes.`);
        }
    } catch (error) {
        console.error('[Admin-Sync] Full Error:', error);
        return sendError(res, 500, 'SYNC_ERROR', 'Failed to sync database.', error.message);
    } finally {
        isSyncing = false;
    }
});

module.exports = router;
