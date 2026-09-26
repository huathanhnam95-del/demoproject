'use strict';

const express = require('express');
const { createTaskLinksService } = require('../../crm/projects/task-links-service');
const { createViewCalendarService } = require('../../crm/projects/view-calendar-service');
const multer = require('multer');
const Busboy = require('busboy');
const {
    createProjectsAccessService,
    ProjectsAccessError,
    PROJECT_ROLES,
    serializeProjectAccess
} = require('../../crm/projects/access-service');
const {
    sendSuccess: defaultSendSuccess,
    sendError: defaultSendError
} = require('../../crm/http-contracts');
const { isProjectsFeatureEnabled } = require('../../crm/projects/feature-config');
const { createProjectsCommandService } = require('../../crm/projects/domain/command-service');
const { createProjectsQueryService } = require('../../crm/projects/domain/query-service');
const { createProjectsChangeFeedService, readFeedHeads, handshakeFromSnapshot } = require('../../crm/projects/change-feed-service');
const { DomainError, id: normalizeRouteProjectId } = require('../../crm/projects/domain/validation');
const { createProjectsDiscussionService } = require('../../crm/projects/discussion-service');
const { createProjectsAttachmentService } = require('../../crm/projects/attachment-service');
const { createProjectsRecoveryService } = require('../../crm/projects/recovery-service');
const { createAutomationRuleService } = require('../../crm/projects/automation/rule-service');
const { createProjectsNotificationService } = require('../../crm/projects/notification-service');
const { createProjectsBudgetService } = require('../../crm/projects/budget-service');
const { assertStaffIdentity } = require('../../crm/projects/budget-service');
const { createProjectsProposalService } = require('../../crm/projects/voice/proposal-service');
const { createAccountedGenerationProvider } = require('../../ai-assistance/providers/accounted-generation');
const { createProjectsDraftService } = require('../../crm/projects/voice/draft-service');
const { assertProjectTask } = require('../../crm/projects/phase4-utils');
const { runTransactionWithClosedRetry } = require('../../crm/projects/domain/transaction-retry');
const { MAX_ATTACHMENT_BYTES, safeDownloadName } = require('../../crm/projects/phase4-utils');

function createProjectsRouter(rawDeps = {}) {
    const deps = rawDeps || {};
    const native = deps.projectsNativeGemini || (process.env.CRM_VOICE_NATIVE_ENABLED === 'true' ? require('../../ai-assistance/providers/native-gemini').createNativeGemini({ apiKey: require('../../ai-assistance/providers/live-chat-credentials').resolveLiveChatApiKey(), generationFormat: 'json' }) : null);
    const sendSuccess = deps.sendSuccess || defaultSendSuccess;
    const sendError = deps.sendError || defaultSendError;
    const service = deps.accessService || createProjectsAccessService({
        db: deps.db,
        auth: deps.auth,
        verifyIdToken: deps.verifyIdToken,
        getAuthUser: deps.getAuthUser,
        resolveLinkedRecordAccess: deps.resolveLinkedRecordAccess,
        now: deps.now,
        bootstrapAdminEmails: deps.bootstrapAdminEmails,
        isBootstrapAdmin: deps.isBootstrapAdmin
    });
    const commandService = deps.commandService || createProjectsCommandService({
        db: deps.db,
        accessService: service,
        now: deps.now
    });
    const queryService = deps.queryService || createProjectsQueryService({
        db: deps.db,
        accessService: service,
        now: deps.now
    });
    const changeFeedService = createProjectsChangeFeedService({ db: deps.db, accessService: service });
    const taskLinksService = createTaskLinksService({ db: deps.db, accessService: service, commandService, authorizeCrmIdentity: deps.authorizeCrmIdentity, now: deps.now });
    const viewCalendarService = createViewCalendarService({ db: deps.db, accessService: service, commandService, queryService, taskLinksService, now: deps.now });
    const discussionService = deps.discussionService || createProjectsDiscussionService({
        db: deps.db,
        accessService: service,
        commandService,
        now: deps.now
    });
    const recoveryService = deps.recoveryService || createProjectsRecoveryService({
        db: deps.db,
        accessService: service,
        commandService,
        queryService,
        now: deps.now
    });
    const draftService = deps.draftService || createProjectsDraftService({
        db: deps.db,
        accessService: service,
        commandService,
        recoveryService,
        taskLinksService,
        now: () => Number(deps.now ? deps.now() : Date.now()),
        engineeringMode: deps.projectsVoiceEngineeringMode === true
    });
    const attachmentService = deps.attachmentService || createProjectsAttachmentService({
        db: deps.db,
        accessService: service,
        commandService,
        getStorageBucket: deps.getStorageBucket || (deps.storageBucket ? async () => deps.storageBucket : async () => null),
        now: deps.now
    });
    const attachmentUpload = multer({
        storage: multer.memoryStorage(),
        limits: { files: 1, fileSize: MAX_ATTACHMENT_BYTES }
    }).single('file');
    const router = express.Router();
    const automationService = deps.automationService || createAutomationRuleService({ db: deps.db, accessService: service, now: deps.now });
    const notificationService = deps.notificationService || createProjectsNotificationService({ db: deps.db, accessService: service, now: deps.now });
    const budgetService = deps.budgetService || createProjectsBudgetService({ db: deps.db, accessService: service, now: deps.now, usageQuota: deps.usageQuota ?? { enabled: true }, ...(native ? { nativeMode: true, nativePolicy: native.policy, pricingRegistry: native.pricingRegistry, providerAdapters: { gemini: native.accountingAdapter } } : {}) });
    let proposalService = deps.proposalService;
    function proposals() {
        if (!proposalService) proposalService = createProjectsProposalService({ db: deps.db, accessService: service, draftService,
            now: () => Number(deps.now ? deps.now() : Date.now()),
            provider: createAccountedGenerationProvider({ ledger: budgetService.ledger, engineeringMode: deps.projectsVoiceEngineeringMode === true,
                engineeringMapping: deps.projectsVoiceEngineeringMode === true ? deps.projectsGenerationMapping || null : null,
                nativeMode: !!native, nativeMapping: native ? { sourceModel: 'gemini-3.8-flash', model: 'gemini-3.8-flash', boundsVersion: native.policy.versionId, maxOutputBytes: 65536, maxOutputTokens: 4096 } : null,
                transport: native ? native.generationTransport : deps.projectsVoiceEngineeringMode === true ? deps.projectsGenerationTransport : null }) });
        return proposalService;
    }

    function parseQueryObject(value, label) {
        try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
            return parsed;
        } catch (_) {
            throw new DomainError(400, 'INVALID_QUERY', `${label} must be a valid JSON object.`);
        }
    }

    function reportError(res, error) {
        if (error instanceof ProjectsAccessError || error?.status) {
            return sendError(
                res,
                Number(error.status) || 500,
                error.code || error.error || 'PROJECTS_ACCESS_ERROR',
                error.message || 'Projects request could not be completed.',
                error.details || null
            );
        }
        console.error('[Projects] Request failed:', error?.stack || error);
        return sendError(res, 500, 'PROJECTS_INTERNAL_ERROR', 'Projects request could not be completed.');
    }

    function parseRawAttachmentMultipart(req) {
        return new Promise((resolve, reject) => {
            const body = {};
            let file = null;
            let fileTooLarge = false;
            let parts = 0;
            let parser;
            try {
                parser = Busboy({ headers: req.headers, limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 8, parts: 10, fieldSize: 4096 } });
            } catch (error) {
                reject(error);
                return;
            }
            parser.on('field', (fieldName, value) => {
                parts += 1;
                body[fieldName] = value;
            });
            parser.on('file', (fieldName, stream, info = {}) => {
                parts += 1;
                if (fieldName !== 'file' || file) {
                    stream.resume();
                    return;
                }
                const chunks = [];
                let size = 0;
                stream.on('data', (chunk) => {
                    size += chunk.length;
                    chunks.push(Buffer.from(chunk));
                });
                stream.on('limit', () => { fileTooLarge = true; });
                stream.on('error', reject);
                stream.on('end', () => {
                    if (!fileTooLarge) file = { fieldname: fieldName, originalname: info.filename || '', encoding: info.encoding || '7bit', mimetype: info.mimeType || 'application/octet-stream', buffer: Buffer.concat(chunks), size };
                });
            });
            parser.on('error', reject);
            parser.on('partsLimit', () => { const error = new Error('Multipart request has too many parts.'); error.code = 'LIMIT_PART_COUNT'; reject(error); });
            parser.on('fieldsLimit', () => { const error = new Error('Multipart request has too many fields.'); error.code = 'LIMIT_FIELD_COUNT'; reject(error); });
            parser.on('filesLimit', () => { const error = new Error('Multipart request has too many files.'); error.code = 'LIMIT_FILE_COUNT'; reject(error); });
            parser.on('finish', () => {
                if (fileTooLarge) {
                    const error = new Error('Uploaded file exceeds the allowed size.');
                    error.code = 'LIMIT_FILE_SIZE';
                    reject(error);
                    return;
                }
                if (!file) {
                    const error = new Error('Attachment file is required.');
                    error.code = 'ATTACHMENT_REQUIRED';
                    reject(error);
                    return;
                }
                req.body = body;
                req.file = file;
                try { normalizeAttachmentFields(req.body); } catch (error) { reject(error); return; }
                resolve();
            });
            if (Buffer.isBuffer(req.rawBody)) parser.end(req.rawBody);
            else req.pipe(parser);
        });
    }

    function parseAttachmentUpload(req, res, next) {
        const isMultipart = String(req.headers?.['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
        if (isMultipart && Buffer.isBuffer(req.rawBody)) {
            return parseRawAttachmentMultipart(req).then(() => next()).catch((error) => {
                if (error?.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', error.message);
                return sendError(res, 400, error?.code || 'INVALID_REQUEST', error?.message || 'Multipart request could not be processed.');
            });
        }
        return attachmentUpload(req, res, (error) => {
            if (error) {
                if (error.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Uploaded file exceeds the allowed size.');
                return sendError(res, 400, error.code || 'INVALID_REQUEST', error.message || 'Multipart request could not be processed.');
            }
            try { normalizeAttachmentFields(req.body || {}); } catch (normalizationError) { return sendError(res, 400, normalizationError.code || 'INVALID_REQUEST', normalizationError.message); }
            return next();
        });
    }

    function normalizeAttachmentFields(body) {
        if (body.expectedMessageRevision === undefined || body.expectedMessageRevision === '') return body;
        const value = typeof body.expectedMessageRevision === 'number' ? body.expectedMessageRevision : Number(body.expectedMessageRevision);
        if (!Number.isSafeInteger(value) || value < 0) {
            const error = new Error('expectedMessageRevision must be a non-negative integer.');
            error.code = 'INVALID_REVISION';
            throw error;
        }
        body.expectedMessageRevision = value;
        return body;
    }

    router.use(async (req, res, next) => {
        if (!isProjectsFeatureEnabled('projects')) {
            return sendError(res, 404, 'PROJECTS_DISABLED', 'Projects is not enabled.');
        }
        try {
            req.projectsIdentity = await service.authenticateRequest(req);
            return next();
        } catch (error) {
            return reportError(res, error);
        }
    });

    async function requireAdmin(req) {
        return service.assertAdmin(req.projectsIdentity);
    }

    async function handle(req, res, fn) {
        try {
            return await fn();
        } catch (error) {
            return reportError(res, error);
        }
    }

    function draftQuery(query) {
        if (Object.keys(query).length) throw new DomainError(400, 'INVALID_QUERY', 'Draft endpoints do not accept query parameters.');
    }
    router.get('/ai/config', (req, res) => handle(req, res, async () => {
        draftQuery(req.query);
        assertStaffIdentity(await runTransactionWithClosedRetry(deps.db, tx => service.assertTransactionEligible(tx, req.projectsIdentity.uid)));
        const configuredUrl = deps.projectsVoiceRelayUrl || process.env.CRM_VOICE_RELAY_URL;
        const relayUrl = (native || deps.projectsVoiceEngineeringMode === true) && typeof configuredUrl === 'string' ? configuredUrl : null;
        res.setHeader('Cache-Control', 'no-store');
        return sendSuccess(res, { relayUrl, voiceAvailable: !!relayUrl, engineeringOnly: !!relayUrl && !native, nativePaidAvailable: !!native, policyMode: native ? 'monitored_target' : 'engineering' });
    }));
    router.post('/ai/proposals', (req, res) => handle(req, res, async () => {
        draftQuery(req.query);
        res.setHeader('Cache-Control', 'no-store');
        return sendSuccess(res, await proposals().propose(req.projectsIdentity, req.body || {}));
    }));
    router.get('/ai/drafts/:draftId', (req, res) => handle(req, res, async () => {
        draftQuery(req.query);
        return sendSuccess(res, await draftService.read(req.projectsIdentity, req.params.draftId));
    }));
    for (const method of ['correct', 'decline', 'preview', 'apply']) {
        router.post(`/ai/drafts/:draftId/${method}`, (req, res) => handle(req, res, async () => {
            draftQuery(req.query);
            return sendSuccess(res, await draftService[method](req.projectsIdentity, req.params.draftId, req.body || {}));
        }));
    }

    function budgetQuery(query, reservations = false) {
        const allowed = reservations ? ['pageSize', 'cursor'] : [];
        if (Object.keys(query).some(key => !allowed.includes(key))) throw new DomainError(400, 'INVALID_QUERY', 'Unsupported budget query parameter.');
        const result = {};
        if (query.pageSize !== undefined) {
            if (typeof query.pageSize !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(query.pageSize)) throw new DomainError(400, 'INVALID_PAGE_SIZE', 'Page size must be 1 through 50.');
            result.pageSize = Number(query.pageSize);
        }
        if (query.cursor !== undefined) {
            if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(query.cursor)) throw new DomainError(400, 'INVALID_CURSOR', 'Invalid budget cursor.');
            result.cursor = query.cursor;
        }
        return result;
    }

    router.get('/budget', (req, res) => handle(req, res, async () => {
        budgetQuery(req.query);
        res.setHeader('Cache-Control', 'no-store');
        return sendSuccess(res, { budget: await budgetService.getBudget(req.projectsIdentity) });
    }));
    router.get('/budget/reservations', (req, res) => handle(req, res, async () => {
        const options = budgetQuery(req.query, true);
        res.setHeader('Cache-Control', 'no-store');
        return sendSuccess(res, await budgetService.listReservations(req.projectsIdentity, options));
    }));

    // Current identity and explicitly assigned projects. An administrator is
    // allowed to use People & Access without receiving project content access.
    router.get('/access', (req, res) => handle(req, res, async () => {
        const result = await service.getAccessSummary(req.projectsIdentity);
        return sendSuccess(res, result);
    }));

    // People & Access administration. These endpoints are intentionally under
    // both router aliases (/api/projects and /api/admin/projects) so local and
    // Functions callers share one contract while legacy /api/admin stays intact.
    router.get(['/people', '/admin/people'], (req, res) => handle(req, res, async () => {
        await requireAdmin(req);
        const people = await service.listPeople();
        return sendSuccess(res, { people, count: people.length });
    }));

    router.patch(['/people/:uid', '/admin/people/:uid'], (req, res) => handle(req, res, async () => {
        const account = await service.updateWorkforce(req.projectsIdentity, req.params.uid, req.body || {});
        return sendSuccess(res, { account }, 'People & Access account updated.');
    }));

    router.post(['/people/:uid/auth-sync/retry', '/admin/people/:uid/auth-sync/retry'], (req, res) => handle(req, res, async () => {
        const account = await service.retryWorkforceAuthSync(req.projectsIdentity, req.params.uid);
        return sendSuccess(res, { account }, 'Account authentication access synchronized.');
    }));

    router.post(['/people/:uid/auth-sync/reconcile', '/admin/people/:uid/auth-sync/reconcile'], (req, res) => handle(req, res, async () => {
        const account = await service.reconcileAbandonedAuthSync(req.projectsIdentity, req.params.uid, req.body || {});
        return sendSuccess(res, { account }, 'Abandoned account authentication operation reconciled.');
    }));

    router.get(['/calendar', '/admin/calendar', '/config/calendar', '/admin/config/calendar'], (req, res) => handle(req, res, async () => {
        const calendar = await service.getOrganizationConfig(req.projectsIdentity);
        return sendSuccess(res, { calendar });
    }));

    router.patch(['/calendar', '/admin/calendar', '/config/calendar', '/admin/config/calendar'], (req, res) => handle(req, res, async () => {
        const calendar = await service.updateOrganizationConfig(req.projectsIdentity, req.body || {});
        return sendSuccess(res, { calendar }, 'Project calendar settings updated.');
    }));

    router.get(['/allowance', '/admin/allowance', '/config/allowance', '/admin/config/allowance'], (req, res) => handle(req, res, async () => {
        const allowance = await service.getAllowanceConfig(req.projectsIdentity);
        return sendSuccess(res, { allowance });
    }));

    router.patch(['/allowance', '/admin/allowance', '/config/allowance', '/admin/config/allowance'], (req, res) => handle(req, res, async () => {
        const allowance = await service.updateAllowanceConfig(req.projectsIdentity, req.body || {});
        return sendSuccess(res, { allowance }, 'Starting Projects allowance updated.');
    }));

    router.get(['/allowance/:uid', '/admin/allowance/:uid', '/config/allowance/:uid', '/admin/config/allowance/:uid'], (req, res) => handle(req, res, async () => {
        const allowance = await service.getAllowanceConfig(req.projectsIdentity, req.params.uid);
        return sendSuccess(res, { allowance });
    }));

    router.patch(['/allowance/:uid', '/admin/allowance/:uid', '/config/allowance/:uid', '/admin/config/allowance/:uid'], (req, res) => handle(req, res, async () => {
        const allowance = await service.updateAllowanceConfig(req.projectsIdentity, req.body || {}, req.params.uid);
        return sendSuccess(res, { allowance }, 'Account Projects allowance updated.');
    }));

    router.get('/', (req, res) => handle(req, res, async () => {
        const projects = await service.listProjects(req.projectsIdentity);
        return sendSuccess(res, { projects });
    }));

    // Phase2 canonical domain commands. Every handler binds the actor to the
    // verifier-backed request identity; the command service rechecks that
    // identity and the membership in its Firestore transaction.
    router.post('/', (req, res) => handle(req, res, async () => {
        const result = await commandService.createProject(req.projectsIdentity, req.body || {});
        return sendSuccess(res, result, 'Project created.');
    }));

    router.get('/notifications', (req, res) => handle(req, res, async () => sendSuccess(res, await notificationService.list(req.projectsIdentity, req.query))));
    router.patch('/notifications/:notificationId', (req, res) => handle(req, res, async () => sendSuccess(res, await notificationService.setRead(req.projectsIdentity, req.params.notificationId, req.body || {}))));
    router.get('/notifications/:notificationId/target', (req, res) => handle(req, res, async () => sendSuccess(res, await notificationService.target(req.projectsIdentity, req.params.notificationId))));
    router.get('/notification-preferences', (req, res) => handle(req, res, async () => sendSuccess(res, await notificationService.preferences(req.projectsIdentity))));
    router.patch('/notification-preferences', (req, res) => handle(req, res, async () => sendSuccess(res, await notificationService.preferences(req.projectsIdentity, req.body || {}))));
    router.get('/:projectId/automations', (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.list(req.projectsIdentity, req.params.projectId, req.query))));
    router.post('/:projectId/automations', (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.create(req.projectsIdentity, req.params.projectId, req.body || {}))));
    router.get('/:projectId/automations/:ruleId', (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.get(req.projectsIdentity, req.params.projectId, req.params.ruleId, req.query.versionId))));
    router.patch('/:projectId/automations/:ruleId', (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.patch(req.projectsIdentity, req.params.projectId, req.params.ruleId, req.body || {}))));
    for (const [route, method] of [['versions', 'appendVersion'], ['preview', 'preview'], ['activate', 'activate'], ['duplicate', 'duplicate']]) {
        router.post(`/:projectId/automations/:ruleId/${route}`, (req, res) => handle(req, res, async () => sendSuccess(res, await automationService[method](req.projectsIdentity, req.params.projectId, req.params.ruleId, req.body || {}))));
    }
    for (const kind of ['versions', 'runs']) router.get(`/:projectId/automations/:ruleId/${kind}`, (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.list(req.projectsIdentity, req.params.projectId, req.query, kind, req.params.ruleId))));
    router.get('/:projectId/automation-runs/:runId', (req, res) => handle(req, res, async () => sendSuccess(res, await automationService.run(req.projectsIdentity, req.params.projectId, req.params.runId))));
    router.get('/:projectId/tasks/:taskId', (req, res) => handle(req, res, async () => {
        const task = await runTransactionWithClosedRetry(deps.db, async transaction => {
            await service.assertTransactionContentAccess(transaction, req.projectsIdentity.uid, req.params.projectId);
            const value = await assertProjectTask(transaction, deps.db, req.params.projectId, req.params.taskId);
            const safe = { ...value.data, id: value.id, effectiveLifecycle: value.effectiveLifecycle };
            delete safe.crmLinks; delete safe.links; delete safe.linkedRecords;
            const pathIds = [value.id]; const ancestorTitles = []; let current = value.data;
            while (current.parentTaskId) { const snapshot = await transaction.get(deps.db.doc(`crmProjects/${req.params.projectId}/tasks/${current.parentTaskId}`)); pathIds.push(current.parentTaskId); current = snapshot.data(); ancestorTitles.push(current.title); }
            return { ...safe, pathIds, ancestorIds: pathIds.slice(1), ancestorTitles, effectiveSectionId: current.sectionId };
        });
        return sendSuccess(res, { task });
    }));

    router.post('/:projectId/sections', (req, res) => handle(req, res, async () => {
        const result = await commandService.createSection(req.projectsIdentity, req.params.projectId, req.body || {});
        return sendSuccess(res, result, 'Project section created.');
    }));

    router.post('/:projectId/columns', (req, res) => handle(req, res, async () => {
        const result = await commandService.createColumn(req.projectsIdentity, req.params.projectId, req.body || {});
        return sendSuccess(res, result, 'Project column created.');
    }));

    router.get('/:projectId/changes', (req, res) => handle(req, res, async () => {
        res.set('Cache-Control', 'no-store');
        return sendSuccess(res, await changeFeedService.poll(req.projectsIdentity, req.params.projectId, req.query || {}));
    }));
    router.post('/:projectId/changes/hydrate', (req, res) => handle(req, res, async () => {
        res.set('Cache-Control', 'no-store');
        return sendSuccess(res, await queryService.hydrateChanges(req.projectsIdentity, req.params.projectId, req.body || {}));
    }));
    // Opening a board in one request: one read-only transaction returns the
    // access check, board records and matching change-feed cursor; project
    // links and the member directory are read after it, so none is older
    // than the cursor. Later pages and branches still use /tasks.
    router.get('/:projectId/open', (req, res) => handle(req, res, async () => {
        res.set('Cache-Control', 'no-store');
        const identity = req.projectsIdentity;
        const projectId = normalizeRouteProjectId(req.params.projectId, 'project ID');
        const snapshot = await queryService.readSnapshot(identity, projectId, { readFeedHeads: (transaction, id) => readFeedHeads(transaction, deps.db, id) });
        const [page, linkedRecords, people] = await Promise.all([
            queryService.queryTasks(identity, projectId, {
                filters: req.query.filters ? parseQueryObject(req.query.filters, 'filters') : {},
                sort: req.query.sort ? parseQueryObject(req.query.sort, 'sort') : { field: req.query.sortField, direction: req.query.sortDirection },
                pageSize: req.query.pageSize,
                includeAncestorContext: req.query.includeAncestorContext
            }, snapshot),
            service.resolveLinkedRecords(snapshot.access.project, identity),
            service.listProjectMemberDirectory(identity, projectId)
        ]);
        return sendSuccess(res, {
            project: serializeProjectAccess({ ...snapshot.access, linkedRecords }),
            membership: snapshot.access.membership.data,
            people,
            page,
            changes: handshakeFromSnapshot(identity, projectId, snapshot.access, snapshot.feedHeads)
        });
    }));
    router.get('/:projectId/tasks', (req, res) => handle(req, res, async () => {
        const result = await queryService.queryTasks(req.projectsIdentity, req.params.projectId, {
            filters: req.query.filters ? parseQueryObject(req.query.filters, 'filters') : req.query,
            sort: req.query.sort ? parseQueryObject(req.query.sort, 'sort') : { field: req.query.sortField, direction: req.query.sortDirection },
            pageSize: req.query.pageSize,
            cursor: req.query.cursor,
            includeAncestorContext: req.query.includeAncestorContext
        });
        return sendSuccess(res, result);
    }));

    router.get('/:projectId/views', (req, res) => handle(req, res, async () => sendSuccess(res, await viewCalendarService.views(req.projectsIdentity, req.params.projectId, { filters: req.query.filters ? parseQueryObject(req.query.filters, 'filters') : {}, pageSize: req.query.pageSize, cursor: req.query.cursor }))));
    router.get('/:projectId/calendar', (req, res) => handle(req, res, async () => sendSuccess(res, await viewCalendarService.calendar(req.projectsIdentity, req.params.projectId, req.query))));
    router.patch('/:projectId/tasks/:taskId/dependencies', (req, res) => handle(req, res, async () => sendSuccess(res, await viewCalendarService.dependencies(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {}))));
    router.post('/:projectId/schedule-preview', (req, res) => handle(req, res, async () => sendSuccess(res, await viewCalendarService.preview(req.projectsIdentity, req.params.projectId, req.body || {}))));
    router.post('/:projectId/schedule-apply', (req, res) => handle(req, res, async () => sendSuccess(res, await viewCalendarService.apply(req.projectsIdentity, req.params.projectId, req.body || {}))));
    router.get('/:projectId/tasks/:taskId/links', (req, res) => handle(req, res, async () => sendSuccess(res, await taskLinksService.readLinks(req.projectsIdentity, req.params.projectId, req.params.taskId))));
    router.patch('/:projectId/tasks/:taskId/links', (req, res) => handle(req, res, async () => sendSuccess(res, await taskLinksService.updateLinks(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {}))));
    router.get('/:projectId/crm-link-options', (req, res) => handle(req, res, async () => sendSuccess(res, await taskLinksService.options(req.projectsIdentity, req.params.projectId, req.query))));
    router.patch('/:projectId/links', (req, res) => handle(req, res, async () => sendSuccess(res, await taskLinksService.updateProjectLinks(req.projectsIdentity, req.params.projectId, req.body || {}))));

    router.post('/:projectId/tasks', (req, res) => handle(req, res, async () => {
        const result = await commandService.createTask(req.projectsIdentity, req.params.projectId, req.body || {});
        return sendSuccess(res, result, 'Project task created.');
    }));

    router.post('/:projectId/tasks/bulk', (req, res) => handle(req, res, async () => {
        const result = await recoveryService.bulkUpdateTasks(req.projectsIdentity, req.params.projectId, req.body || {});
        return sendSuccess(res, result, 'Project tasks updated.');
    }));

    router.get('/:projectId/tasks/:taskId/discussion', (req, res) => handle(req, res, async () => {
        const result = await discussionService.listMessages(req.projectsIdentity, req.params.projectId, req.params.taskId, req.query || {});
        return sendSuccess(res, result);
    }));

    router.post('/:projectId/tasks/:taskId/discussion/messages', (req, res) => handle(req, res, async () => {
        const result = await discussionService.createMessage(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {});
        return sendSuccess(res, result, 'Discussion message created.');
    }));

    router.post('/:projectId/tasks/:taskId/discussion/messages/:messageId/replies', (req, res) => handle(req, res, async () => {
        const result = await discussionService.replyToMessage(req.projectsIdentity, req.params.projectId, req.params.taskId, { ...(req.body || {}), parentMessageId: req.params.messageId });
        return sendSuccess(res, result, 'Discussion reply created.');
    }));

    router.patch('/:projectId/tasks/:taskId/discussion/messages/:messageId', (req, res) => handle(req, res, async () => {
        const result = await discussionService.editMessage(req.projectsIdentity, req.params.projectId, req.params.messageId, req.body || {}, req.params.taskId);
        return sendSuccess(res, result, 'Discussion message updated.');
    }));

    router.post('/:projectId/tasks/:taskId/discussion/messages/:messageId/moderate', (req, res) => handle(req, res, async () => {
        const result = await discussionService.moderateMessage(req.projectsIdentity, req.params.projectId, req.params.messageId, req.body || {}, req.params.taskId);
        return sendSuccess(res, result, 'Discussion moderation recorded.');
    }));

    router.get('/:projectId/tasks/:taskId/discussion/messages/:messageId/history', (req, res) => handle(req, res, async () => {
        const result = await discussionService.listMessageHistory(req.projectsIdentity, req.params.projectId, req.params.messageId, req.query || {}, req.params.taskId);
        return sendSuccess(res, result);
    }));

    router.post('/:projectId/tasks/:taskId/discussion/messages/:messageId/attachments', parseAttachmentUpload, (req, res) => handle(req, res, async () => {
        const result = await attachmentService.uploadAttachment(req.projectsIdentity, req.params.projectId, req.params.taskId, req.params.messageId, req.file, req.body || {});
        return sendSuccess(res, result, 'Private discussion attachment uploaded.');
    }));

    router.get('/:projectId/tasks/:taskId/discussion/messages/:messageId/attachments/:attachmentId/download', (req, res) => handle(req, res, async () => {
        const result = await attachmentService.downloadAttachment(req.projectsIdentity, req.params.projectId, req.params.attachmentId, { taskId: req.params.taskId, messageId: req.params.messageId });
        res.setHeader('Content-Type', result.metadata.contentType);
        res.setHeader('Content-Length', String(result.bytes.length));
        res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(result.metadata.originalName)}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(result.bytes);
    }));

    router.patch('/:projectId/tasks/:taskId', (req, res) => handle(req, res, async () => {
        const result = await commandService.updateTask(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {});
        return sendSuccess(res, result, 'Project task updated.');
    }));

    router.patch('/:projectId', (req, res) => handle(req, res, async () => {
        const result = await commandService.updateProject(req.projectsIdentity, req.params.projectId, req.body || {});
        return sendSuccess(res, result, 'Project updated.');
    }));

    router.patch('/:projectId/sections/:sectionId', (req, res) => handle(req, res, async () => {
        const result = await commandService.updateSection(req.projectsIdentity, req.params.projectId, req.params.sectionId, req.body || {});
        return sendSuccess(res, result, 'Project section updated.');
    }));

    router.patch('/:projectId/columns/:columnId', (req, res) => handle(req, res, async () => {
        const result = await commandService.updateColumn(req.projectsIdentity, req.params.projectId, req.params.columnId, req.body || {});
        return sendSuccess(res, result, 'Project column updated.');
    }));

    router.post('/:projectId/columns/:columnId/replace', (req, res) => handle(req, res, async () => {
        const result = await commandService.replaceColumn(req.projectsIdentity, req.params.projectId, req.params.columnId, req.body || {});
        return sendSuccess(res, result, 'Project column replaced.');
    }));

    router.post('/:projectId/columns/:columnId/archive', (req, res) => handle(req, res, async () => {
        const result = await commandService.archiveColumn(req.projectsIdentity, req.params.projectId, req.params.columnId, req.body || {});
        return sendSuccess(res, result, 'Project column archived.');
    }));

    router.post('/:projectId/sections/:sectionId/move', (req, res) => handle(req, res, async () => {
        const result = await commandService.moveSection(req.projectsIdentity, req.params.projectId, req.params.sectionId, req.body || {});
        return sendSuccess(res, result, 'Project section moved.');
    }));

    router.post('/:projectId/columns/:columnId/move', (req, res) => handle(req, res, async () => {
        const result = await commandService.moveColumn(req.projectsIdentity, req.params.projectId, req.params.columnId, req.body || {});
        return sendSuccess(res, result, 'Project column moved.');
    }));

    router.post('/:projectId/tasks/:taskId/move', (req, res) => handle(req, res, async () => {
        const result = await commandService.moveTask(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {});
        return sendSuccess(res, result, 'Project task moved.');
    }));

    router.post('/:projectId/operations/:operationId/undo', (req, res) => handle(req, res, async () => {
        const result = await recoveryService.undoOperation(req.projectsIdentity, req.params.projectId, req.params.operationId, req.body || {});
        return sendSuccess(res, result, 'Project operation undone.');
    }));

    router.get('/:projectId/history', (req, res) => handle(req, res, async () => {
        const result = await recoveryService.listHistory(req.projectsIdentity, req.params.projectId, req.query || {});
        return sendSuccess(res, result);
    }));

    router.get('/:projectId/recovery', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.listRecovery(req.projectsIdentity, req.params.projectId, req.query || {}))));
    router.get('/:projectId/recovery/preview', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.previewRecovery(req.projectsIdentity, req.params.projectId, req.query || {}))));

    router.post('/:projectId/archive', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.archiveProject(req.projectsIdentity, req.params.projectId, req.body || {}), 'Project archived.')));
    router.post('/:projectId/trash', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.trashProject(req.projectsIdentity, req.params.projectId, req.body || {}), 'Project moved to Trash.')));
    router.post('/:projectId/restore', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.restoreProject(req.projectsIdentity, req.params.projectId, req.body || {}), 'Project restored.')));
    router.post('/:projectId/sections/:sectionId/archive', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.archiveSection(req.projectsIdentity, req.params.projectId, req.params.sectionId, req.body || {}), 'Section archived.')));
    router.post('/:projectId/sections/:sectionId/trash', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.trashSection(req.projectsIdentity, req.params.projectId, req.params.sectionId, req.body || {}), 'Section moved to Trash.')));
    router.post('/:projectId/sections/:sectionId/restore', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.restoreSection(req.projectsIdentity, req.params.projectId, req.params.sectionId, req.body || {}), 'Section restored.')));
    router.post('/:projectId/tasks/:taskId/archive', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.archiveTask(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {}), 'Task archived.')));
    router.post('/:projectId/tasks/:taskId/trash', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.trashTask(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {}), 'Task moved to Trash.')));
    router.post('/:projectId/tasks/:taskId/restore', (req, res) => handle(req, res, async () => sendSuccess(res, await recoveryService.restoreTask(req.projectsIdentity, req.params.projectId, req.params.taskId, req.body || {}), 'Task restored.')));

    router.get('/:projectId/eligible-people', (req, res) => handle(req, res, async () => {
        const people = await service.listEligiblePeople(req.projectsIdentity, req.params.projectId);
        return sendSuccess(res, { people });
    }));

    router.get('/:projectId/member-directory', (req, res) => handle(req, res, async () => {
        const people = await service.listProjectMemberDirectory(req.projectsIdentity, req.params.projectId);
        return sendSuccess(res, { people });
    }));

    router.get('/:projectId', (req, res) => handle(req, res, async () => {
        const access = await service.authorizeProject(req.projectsIdentity, req.params.projectId);
        return sendSuccess(res, {
            project: serializeProjectAccess(access),
            membership: access.membership.data
        });
    }));

    router.get('/:projectId/links', (req, res) => handle(req, res, async () => sendSuccess(res, await taskLinksService.projectLinks(req.projectsIdentity, req.params.projectId))));

    router.get('/:projectId/members', (req, res) => handle(req, res, async () => {
        const members = await service.listProjectMembers(req.projectsIdentity, req.params.projectId);
        return sendSuccess(res, { members, roles: PROJECT_ROLES });
    }));

    router.post('/:projectId/members', (req, res) => handle(req, res, async () => {
        const member = await service.addOrUpdateMember(
            req.projectsIdentity,
            req.params.projectId,
            req.body?.uid,
            req.body || {}
        );
        return sendSuccess(res, { member }, 'Project member added.');
    }));

    router.patch('/:projectId/members/:uid', (req, res) => handle(req, res, async () => {
        const member = await service.addOrUpdateMember(
            req.projectsIdentity,
            req.params.projectId,
            req.params.uid,
            req.body || {}
        );
        return sendSuccess(res, { member }, 'Project member updated.');
    }));

    router.delete('/:projectId/members/:uid', (req, res) => handle(req, res, async () => {
        const removed = await service.removeMember(
            req.projectsIdentity,
            req.params.projectId,
            req.params.uid,
            req.body || {}
        );
        return sendSuccess(res, { removed }, 'Project member removed.');
    }));

    router.post('/:projectId/owner-transfer', (req, res) => handle(req, res, async () => {
        const transfer = await service.transferOwner(
            req.projectsIdentity,
            req.params.projectId,
            req.body?.targetUid,
            req.body || {}
        );
        return sendSuccess(res, { transfer }, 'Project ownership transferred.');
    }));

    router.post('/:projectId/transfer-owner', (req, res) => handle(req, res, async () => {
        const transfer = await service.transferOwner(
            req.projectsIdentity,
            req.params.projectId,
            req.body?.targetUid,
            req.body || {}
        );
        return sendSuccess(res, { transfer }, 'Project ownership transferred.');
    }));

    return router;
}

module.exports = createProjectsRouter;
module.exports.createProjectsRouter = createProjectsRouter;
