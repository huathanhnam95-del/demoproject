const {
    CRM_AGENT_SOURCES,
    CRM_INVOICES,
    CRM_COMMISSIONS,
    CRM_STUDENTS,
    CRM_COURSES
} = require('../../crm/collections');
const {
    buildAgentSourceCreateData,
    buildAgentSourcePatchData,
    mapAgentSourceRecord
} = require('../../crm/agent-source-service');
const { mapInvoiceRecord } = require('../../crm/finance-service');
const { mapStudentRecord } = require('../../crm/student-service');
const { mapCourseRecord } = require('../../crm/course-service');

const BANGKOK_UTC_OFFSET_HOURS = 7;

function toDate(value) {
    if (value instanceof Date) return value;
    if (value && typeof value.toDate === 'function') return value.toDate();
    if (value && typeof value === 'object' && Number.isFinite(value.seconds)) {
        return new Date((Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6));
    }
    if (value && typeof value === 'object' && Number.isFinite(value._seconds)) {
        return new Date((Number(value._seconds) * 1000) + Math.floor(Number(value._nanoseconds || 0) / 1e6));
    }
    if (typeof value === 'number' || typeof value === 'string') {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
}

function parseMonthInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month };
}

function getCurrentBangkokMonth() {
    const shifted = new Date(Date.now() + (BANGKOK_UTC_OFFSET_HOURS * 60 * 60 * 1000));
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1
    };
}

function formatMonthKey({ year, month }) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function getBangkokMonthWindow({ year, month }) {
    const startUtc = new Date(Date.UTC(year, month - 1, 1, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));
    const endUtc = new Date(Date.UTC(year, month, 1, -BANGKOK_UTC_OFFSET_HOURS, 0, 0, 0));
    return { startUtc, endUtc };
}

function moneyDecimals(currency) {
    return String(currency || '').toUpperCase() === 'VND' ? 0 : 2;
}

function roundMoney(value, currency) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    const decimals = moneyDecimals(currency);
    const factor = 10 ** decimals;
    return Math.round(amount * factor) / factor;
}

function formatMoney(value, currency) {
    const safeCurrency = String(currency || 'VND').toUpperCase();
    const decimals = moneyDecimals(safeCurrency);
    const amount = roundMoney(value, safeCurrency);
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(amount);
}

async function fetchDocsByIds(db, collectionName, ids) {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
    const pairs = await Promise.all(uniqueIds.map(async (id) => {
        const snap = await db.collection(collectionName).doc(id).get();
        if (!snap.exists) return null;
        return [id, snap];
    }));
    const map = new Map();
    pairs.forEach((pair) => {
        if (!pair) return;
        map.set(pair[0], pair[1]);
    });
    return map;
}

module.exports = function registerAgentSourceRoutes(router, deps) {
    const { db, sendSuccess, sendError, requireAdminHandlers, serverTimestamp, writeAuditLog } = deps;

    router.get('/agent-sources', ...requireAdminHandlers, async (req, res) => {
        try {
            const requestedLimit = Number(req.query?.limit);
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
                : 200;
            const q = String(req.query?.q || '').trim().toLowerCase();

            const snap = await db.collection(CRM_AGENT_SOURCES).orderBy('createdAt', 'desc').limit(limit).get();
            let agentSources = snap.docs.map((doc) => mapAgentSourceRecord(doc, doc.id));
            if (q) {
                agentSources = agentSources.filter((row) => String(row.name || '').toLowerCase().includes(q));
            }
            agentSources.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
            return sendSuccess(res, { agentSources, count: agentSources.length });
        } catch (error) {
            return sendError(res, 500, 'LIST_AGENT_SOURCES_ERROR', 'Failed to list agent sources.', error?.message || error);
        }
    });

    router.post('/agent-sources', ...requireAdminHandlers, async (req, res) => {
        try {
            const payload = buildAgentSourceCreateData(req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            const ref = db.collection(CRM_AGENT_SOURCES).doc();
            await ref.set(payload);
            await writeAuditLog?.({
                action: 'agent_source.create',
                entityType: 'agent_source',
                entityId: ref.id,
                metadata: { status: payload.status || null }
            }, { user: req.user });
            return sendSuccess(res, { agentSourceId: ref.id }, 'Agent source created.');
        } catch (error) {
            if ((error?.message || '').includes('Agent source')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            if ((error?.message || '').includes('Invalid agent source status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'CREATE_AGENT_SOURCE_ERROR', 'Failed to create agent source.', error?.message || error);
        }
    });

    router.patch('/agent-sources/:agentSourceId', ...requireAdminHandlers, async (req, res) => {
        try {
            const agentSourceId = String(req.params.agentSourceId || '').trim();
            if (!agentSourceId) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid agentSourceId.');
            }

            const ref = db.collection(CRM_AGENT_SOURCES).doc(agentSourceId);
            const snap = await ref.get();
            if (!snap.exists) {
                return sendError(res, 404, 'AGENT_SOURCE_NOT_FOUND', 'Agent source not found.');
            }
            const next = buildAgentSourcePatchData(snap.data() || {}, req.body || {}, {
                user: req.user,
                serverTimestamp
            });
            await ref.set(next, { merge: true });
            await writeAuditLog?.({
                action: 'agent_source.update',
                entityType: 'agent_source',
                entityId: agentSourceId,
                metadata: { status: next.status || null }
            }, { user: req.user });

            const updated = await ref.get();
            return sendSuccess(res, { agentSource: mapAgentSourceRecord(updated, agentSourceId) }, 'Agent source updated.');
        } catch (error) {
            if ((error?.message || '').includes('No agent source fields')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            if ((error?.message || '').includes('Agent source name is required')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            if ((error?.message || '').includes('Invalid agent source status')) {
                return sendError(res, 400, 'VALIDATION_ERROR', error.message);
            }
            return sendError(res, 500, 'UPDATE_AGENT_SOURCE_ERROR', 'Failed to update agent source.', error?.message || error);
        }
    });

    router.get('/agent-sources/report', ...requireAdminHandlers, async (req, res) => {
        try {
            const parsedMonth = parseMonthInput(req.query?.month) || getCurrentBangkokMonth();
            const month = formatMonthKey(parsedMonth);
            const format = String(req.query?.format || 'json').trim().toLowerCase();
            const { startUtc, endUtc } = getBangkokMonthWindow(parsedMonth);

            const [sourceSnap, invoicesSnap, commissionsSnap] = await Promise.all([
                db.collection(CRM_AGENT_SOURCES).get(),
                db.collection(CRM_INVOICES).where('status', '==', 'paid').get(),
                db.collection(CRM_COMMISSIONS).where('role', '==', 'agent_source').get()
            ]);

            const sourceById = new Map(sourceSnap.docs.map((doc) => {
                const mapped = mapAgentSourceRecord(doc, doc.id);
                return [String(mapped.agentSourceId || '').trim(), mapped];
            }));
            const commissionByInvoiceId = new Map();
            commissionsSnap.docs.forEach((doc) => {
                const row = doc.data() || {};
                const invoiceId = String(row.invoiceId || '').trim();
                if (!invoiceId || commissionByInvoiceId.has(invoiceId)) return;
                commissionByInvoiceId.set(invoiceId, { commissionId: doc.id, ...row });
            });

            const invoiceRows = invoicesSnap.docs
                .map((doc) => mapInvoiceRecord(doc, doc.id))
                .filter((invoice) => {
                    const paidAt = toDate(invoice.paidAt);
                    if (!paidAt) return false;
                    return paidAt >= startUtc && paidAt < endUtc;
                })
                .filter((invoice) => String(invoice.agentSourceId || '').trim());

            const studentIds = invoiceRows.map((invoice) => String(invoice.studentId || '').trim()).filter(Boolean);
            const courseIds = invoiceRows.map((invoice) => String(invoice.courseId || '').trim()).filter(Boolean);
            const [studentDocMap, courseDocMap] = await Promise.all([
                fetchDocsByIds(db, CRM_STUDENTS, studentIds),
                fetchDocsByIds(db, CRM_COURSES, courseIds)
            ]);
            const studentById = new Map(Array.from(studentDocMap.entries()).map(([id, snap]) => [id, mapStudentRecord(snap, id)]));
            const courseById = new Map(Array.from(courseDocMap.entries()).map(([id, snap]) => [id, mapCourseRecord(snap, id)]));

            const rows = invoiceRows.map((invoice) => {
                const sourceId = String(invoice.agentSourceId || '').trim();
                const source = sourceById.get(sourceId) || null;
                const student = studentById.get(String(invoice.studentId || '').trim()) || null;
                const course = courseById.get(String(invoice.courseId || '').trim()) || null;
                const commission = commissionByInvoiceId.get(String(invoice.invoiceId || '').trim()) || null;
                const currency = String(invoice.currency || commission?.currency || 'VND').toUpperCase();
                const tuition = roundMoney(invoice.netAmount, currency);
                const rateBps = Number(commission?.rateBps ?? invoice.agentCommissionBps ?? 0);
                const computedCommission = roundMoney((tuition * rateBps) / 10000, currency);
                const commissionAmount = roundMoney(commission?.amount ?? computedCommission, currency);
                const paidAtDate = toDate(invoice.paidAt);

                return {
                    agentSourceId: sourceId,
                    agentSourceName: String(source?.name || sourceId || 'Unknown').trim(),
                    studentId: String(invoice.studentId || '').trim() || null,
                    studentName: String(student?.name || student?.email || invoice.studentId || 'Unknown').trim(),
                    courseId: String(invoice.courseId || '').trim() || null,
                    courseName: String(course?.name || invoice.courseId || 'Unassigned').trim(),
                    invoiceId: String(invoice.invoiceId || '').trim() || null,
                    paidAt: paidAtDate ? paidAtDate.toISOString() : null,
                    currency,
                    tuition,
                    rateBps: Number.isFinite(rateBps) ? rateBps : 0,
                    commissionAmount,
                    commissionStatus: String(commission?.status || 'pending').trim().toLowerCase() || 'pending'
                };
            });

            rows.sort((left, right) => {
                const byAgent = String(left.agentSourceName || '').localeCompare(String(right.agentSourceName || ''));
                if (byAgent !== 0) return byAgent;
                return String(left.studentName || '').localeCompare(String(right.studentName || ''));
            });

            const summaryByAgentCurrency = new Map();
            rows.forEach((row) => {
                const key = `${row.agentSourceId}::${row.currency}`;
                if (!summaryByAgentCurrency.has(key)) {
                    summaryByAgentCurrency.set(key, {
                        agentSourceId: row.agentSourceId,
                        agentSourceName: row.agentSourceName,
                        currency: row.currency,
                        studentCount: 0,
                        tuitionTotal: 0,
                        commissionTotal: 0
                    });
                }
                const bucket = summaryByAgentCurrency.get(key);
                bucket.studentCount += 1;
                bucket.tuitionTotal = roundMoney(bucket.tuitionTotal + row.tuition, row.currency);
                bucket.commissionTotal = roundMoney(bucket.commissionTotal + row.commissionAmount, row.currency);
            });

            const summary = Array.from(summaryByAgentCurrency.values())
                .sort((left, right) => {
                    const byAgent = String(left.agentSourceName || '').localeCompare(String(right.agentSourceName || ''));
                    if (byAgent !== 0) return byAgent;
                    return String(left.currency || '').localeCompare(String(right.currency || ''));
                });

            if (format === 'xlsx') {
                const ExcelJS = require('exceljs');
                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'BEL CRM';
                workbook.created = new Date();

                const rowsSheet = workbook.addWorksheet('Rows');
                rowsSheet.columns = [
                    { header: 'Agent Source', key: 'agentSourceName', width: 28 },
                    { header: 'Student', key: 'studentName', width: 28 },
                    { header: 'Course', key: 'courseName', width: 24 },
                    { header: 'Invoice ID', key: 'invoiceId', width: 24 },
                    { header: 'Paid At (UTC)', key: 'paidAt', width: 26 },
                    { header: 'Currency', key: 'currency', width: 12 },
                    { header: 'Tuition Fee', key: 'tuition', width: 18 },
                    { header: 'Commission Rate %', key: 'ratePercent', width: 18 },
                    { header: 'Commission Amount', key: 'commissionAmount', width: 20 },
                    { header: 'Commission Status', key: 'commissionStatus', width: 18 }
                ];
                rows.forEach((row) => {
                    rowsSheet.addRow({
                        ...row,
                        ratePercent: roundMoney((Number(row.rateBps || 0) / 100), 'USD')
                    });
                });

                const summarySheet = workbook.addWorksheet('Summary');
                summarySheet.columns = [
                    { header: 'Agent Source', key: 'agentSourceName', width: 28 },
                    { header: 'Currency', key: 'currency', width: 12 },
                    { header: 'Rows', key: 'studentCount', width: 10 },
                    { header: 'Tuition Total', key: 'tuitionTotal', width: 18 },
                    { header: 'Commission Total', key: 'commissionTotal', width: 20 }
                ];
                summary.forEach((row) => {
                    summarySheet.addRow(row);
                });

                const fileName = `agent-report-${month}.xlsx`;
                const buffer = await workbook.xlsx.writeBuffer();
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                return res.status(200).send(Buffer.from(buffer));
            }

            return sendSuccess(res, {
                month,
                startUtc: startUtc.toISOString(),
                endUtc: endUtc.toISOString(),
                rows,
                summary,
                rowCount: rows.length
            });
        } catch (error) {
            if ((error?.message || '').includes('Invalid time value')) {
                return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid month format. Use YYYY-MM.');
            }
            return sendError(res, 500, 'AGENT_REPORT_ERROR', 'Failed to build agent report.', error?.message || error);
        }
    });
};
