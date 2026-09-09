window.CrmDataInputWorkspace = (function () {
    'use strict';
    const clone = value => JSON.parse(JSON.stringify(value));
    function appendVoiceConfirmations(host, voiceContext) {
        for (const [key, title] of [['confirmationPhrase', 'Voice confirmation'], ['confirmationPhraseEnglish', 'Voice confirmation (English)']]) {
            if (typeof voiceContext?.[key] !== 'string' || !voiceContext[key]) continue;
            const line = host.ownerDocument.createElement('p'); line.textContent = `${title}: ${voiceContext[key]}`; host.append(line);
        }
    }
    const person = 'agentSourceId name email phone zalo facebook facebookProfileUrl facebookPersonalOwner dateOfBirth gender notes preferredLearningDays preferredLearningHours learningProfile targets';
    const definitions = {
        createLead: ['Create enquiry', `${person} source learningNeeds stage probability nextActionAt`, ['leadId']],
        updateLead: ['Update enquiry', `leadId ${person} source learningNeeds stage probability nextActionAt`, ['leadId']],
        createStudent: ['Create student', `${person} label acquisitionSource preferredSchedule counselingNotes contacts`, ['studentId']],
        updateStudent: ['Update student', `studentId ${person} label acquisitionSource preferredSchedule counselingNotes contacts`, ['studentId']],
        convertLead: ['Convert enquiry to student', 'leadId', ['leadId', 'studentId']],
        createEntranceTest: ['Create entrance test', 'leadId studentId testType', ['testId']],
        createEnrollment: ['Enroll student', 'studentId classId courseId teacherUid startDate endDate timezone slots notes', ['enrollmentId', 'classId']],
        seedClassSchedule: ['Create class sessions', 'classId teacherUid startDate endDate weekdayNumbers startTime', ['classId']],
        createInvoice: ['Create invoice', 'studentId enrollmentId courseId amount discount currency dueDate notes', ['invoiceId']],
        recordPayment: ['Record payment', 'studentId invoiceId enrollmentId amount method paidAt reference notes', ['paymentId']]
    };
    const recordKinds = { agentSourceId: 'agentSource', teacherUid: 'teacher', leadId: 'lead', studentId: 'student', classId: 'classroom', courseId: 'course', enrollmentId: 'enrollment', invoiceId: 'invoice' };
    const labels = { agentSourceId: 'Agent source', nextActionAt: 'Next follow-up', teacherUid: 'Teacher', leadId: 'Enquiry', studentId: 'Student', classId: 'Class', courseId: 'Course', enrollmentId: 'Enrollment', invoiceId: 'Invoice', testType: 'Test type', slots: 'Weekly schedule', weekdayNumbers: 'Weekdays', amount: 'Amount', discount: 'Discount amount', paidAt: 'Payment date' };
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    function label(key) { return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()); }
    function validationMessages(details, actions) {
        const instructions = { REQUIRED_FIELD: 'is required.', CLARIFY_DATE: 'needs an exact date (YYYY-MM-DD).', CLARIFY_DATETIME: 'needs an exact date (YYYY-MM-DD) or a time with its UTC offset.', INVALID_AMOUNT: 'must be a number greater than zero.', DATE_ORDER: 'must be on or after the start date.', INVALID_REFERENCE: 'must refer to an available record or valid output in this draft.', CYCLIC_REFERENCE: 'depends on another action that also depends on this step. Select an existing record or remove the circular reference.' };
        if (!Array.isArray(details?.issues)) return [];
        return details.issues.slice(0, 200).map(issue => {
            if (issue.code === 'EMPTY_DRAFT') return 'Add at least one action before reviewing.';
            if (issue.code === 'RECORD_LOOKUP_REQUIRED') return `Resolve the requested ${label(issue.kind || 'record').toLowerCase()} lookup before reviewing.`;
            const index = actions.findIndex(action => action.actionId === issue.actionId);
            if (issue.code === 'MODEL_CLARIFICATION') return `${index >= 0 ? `Step ${index + 1}: ` : ''}${String(issue.text || 'Clarify this value before reviewing.')}`;
            const field = issue.field === 'leadIdOrStudentId' ? 'Enquiry or student' : issue.field ? issue.field.split('.').map(label).join(' · ') : 'This action';
            return `${index >= 0 ? `Step ${index + 1}: ` : ''}${field} ${instructions[issue.code] || 'needs correction.'}`;
        });
    }
    function safeLink(value, origin) {
        try { const url = new URL(value, origin); return ['http:', 'https:'].includes(url.protocol) && url.origin === origin ? url.href : null; } catch { return null; }
    }
    function parseValue(type, value) {
        const text = String(value).trim();
        if (type === 'number') { if (!text) return null; const number = Number(text); if (!Number.isFinite(number)) throw new Error('Enter a valid number.'); return number; }
        if (type === 'list') return text ? text.split(',').map(item => item.trim()).filter(Boolean) : [];
        return text;
    }
    function createRecordLabelResolver({ request, getUid, format }) {
        let generation = 0, queue = Promise.resolve();
        const cache = new Map();
        function clear() { generation++; cache.clear(); }
        function resolve(kind, id) {
            const uid = getUid(), epoch = generation, key = `${uid}/${kind}/${id}`;
            if (!uid) return Promise.resolve(null);
            if (cache.has(key)) return cache.get(key);
            const current = () => generation === epoch && getUid() === uid;
            const pending = queue.then(async () => {
                if (!current()) return null;
                try {
                    const response = await request('/api/admin/data-input/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, id }) });
                    if (!current() || response.status !== 'resolved' || response.record?.kind !== kind || response.record.id !== id) return null;
                    return format(response.record);
                } catch { return null; }
            });
            queue = pending; cache.set(key, pending); return pending;
        }
        return { resolve, clear };
    }
    function createVoiceBridge({ client, getUid, isDirty = () => false, transport, onContextError = () => {} }) {
        let previous = null;
        function getContext() {
            const state = client.getState();
            if (state.uid !== getUid() || !state.draft) return {};
            return isDirty() ? { draftId: state.draft.draftId } : client.getVoiceHints();
        }
        return {
            getContext,
            async sync() {
                const state = client.getState(), key = JSON.stringify([getUid(), state.draft?.revision, getContext()]);
                if (key === previous) return; previous = key;
                try { await transport?.updateContext?.(); } catch { onContextError(); }
            },
            async confirm(reference, context) {
                if (!context || context.actorUid !== getUid() || context.actorUid !== client.getState().uid) throw new Error('The voice account changed.');
                if (isDirty()) throw new Error('Draft has unsaved details. Review again before confirming.');
                return client.commitVoice(reference, context);
            }
        };
    }
    function createSpokenInstructionHandler({ client, getUid, saveDraft, getSelections = () => [], isDirty = () => false, getNavigationKey = () => null }) {
        let processing = false;
        return async (text, context) => {
            if (processing) throw new Error('An instruction is already being processed.');
            let draftId = null; const navigationKey = getNavigationKey();
            function current() {
                if (!context || context.actorUid !== getUid() || context.actorUid !== client.getState().uid) throw new Error('The voice account changed.');
                if (context.signal?.aborted) throw new Error('Voice stopped. Check the draft before continuing.');
                if (getNavigationKey() !== navigationKey) throw new Error('The active workspace changed. Check the draft before continuing.');
                const state = client.getState();
                if (draftId && state.draft?.draftId !== draftId) throw new Error('The active draft changed.');
                if (state.pendingSave) throw new Error('Check the save status before changing this draft.');
                return state;
            }
            const initial = current(); draftId = initial.draft?.draftId || null;
            if (initial.capabilities?.interpretation !== true) throw new Error('AI interpretation is unavailable. You can still edit the draft.');
            if (initial.busy || ['running', 'unknown'].includes(initial.interpretation?.status)) throw new Error('Check the interpretation status before another instruction.');
            if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Enter an instruction of at most 16000 characters.');
            processing = true;
            try {
                await saveDraft(); draftId ||= current().draft?.draftId || null; current();
                await client.interpret(text, getSelections()); draftId ||= current().draft?.draftId || null;
                let state = current();
                if (isDirty()) return { status: 'needs_review' };
                // Resolve only an unambiguous server result, and allow at most
                // one continuation. Questions and ambiguous records stay visible.
                if (state.interpretation?.status === 'applied' && state.draft?.pendingLookups?.length) {
                    const count = state.draft.pendingLookups.length, revision = state.draft.revision;
                    const resolved = await client.lookups(getSelections()); state = current();
                    if (isDirty()) return { status: 'needs_review' };
                    const queries = resolved?.queries || [];
                    if (state.draft.revision !== revision || resolved.revision !== revision || queries.length !== count
                        || !Array.from({ length: count }, (_, index) => index).every(index => queries.some(query => query.lookupIndex === index && query.result?.status === 'resolved'))) return { status: 'needs_input' };
                    await client.interpret('Continue the pending instruction using the resolved records.', getSelections()); state = current();
                }
                if (isDirty()) return { status: 'needs_review' };
                if (state.interpretation?.status !== 'applied' || !state.draft?.actions?.length || state.draft.pendingLookups?.length || state.draft.interpretationQuestions?.length) return { status: 'needs_input' };
                await client.review(); current(); return { status: 'review' };
            } finally { processing = false; }
        };
    }
    function createInstructionPipeline(options) {
        const spoken = createSpokenInstructionHandler(options);
        return { spoken, continueInstruction(text) {
            return spoken(text || 'Continue the pending instruction using the resolved records.', { actorUid: options.getUid() });
        } };
    }
    function createController({ elements: e, request, getUid, getIdToken, initialCapabilities = {}, getActivePanel = () => '', showToast = () => {}, voiceTransport = null }) {
        const doc = e.belChatDrawer.ownerDocument;
        let rows = [], removed = [], dirty = false, loadedRevision = null, owner = null, saving = false, disposed = false;
        let current = {}, client, form, status, history, toolbar, saveButton, reviewButton, confirmButton, recoverButton, addButton, kindSelect, instructionButton, interpretationRecovery, intro;
        const recordLabels = new Map(), listeners = [], lookupSelections = new Map();
        const labelResolver = createRecordLabelResolver({ request, getUid, format: recordName });
        let lookupPanel, lookupIdentity = null, attachmentPanel, voicePanel, voiceBridge, budgetPanel, instructionPipeline, wasBusy = false;
        const injectedVoiceTransport = !!voiceTransport;
        const paymentAcknowledgements = new Set(); let paymentReviewIdentity = null;
        const lookupFields = { agentSource: 'name', teacher: 'displayName name email', lead: 'name label crmId phone email', student: 'name label crmId phone email', course: 'name', classroom: 'name', enrollment: 'studentId classId', invoice: 'studentId enrollmentId' };
        function node(tag, text, className) { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
        function listen(el, event, fn) { el.addEventListener(event, fn); listeners.push(() => el.removeEventListener(event, fn)); }
        function button(text, fn, primary = false) { const el = node('button', text, primary ? 'crm-btn-primary' : 'crm-btn-secondary'); el.type = 'button'; el.addEventListener('click', fn); return el; }
        function option(select, value, text) { const el = node('option', text); el.value = value; select.append(el); }
        function field(title, control) { const wrapper = node('label', undefined, 'crm-input-field'); control.setAttribute('aria-label', title); wrapper.append(node('span', title), control); return wrapper; }
        function changed() { dirty = true; paymentAcknowledgements.clear(); e.belChatPreview.replaceChildren(node('p', 'Draft changed. Review again before saving.')); controls(); void voiceBridge?.sync(); }
        function terminal() { return ['committed', 'cancelled'].includes(current.draft?.status); }
        function controls() {
            const locked = current.busy || current.pendingSave || !!current.pendingAttachment || terminal();
            const interpreting = ['running', 'unknown'].includes(current.interpretation?.status);
            form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = locked; });
            lookupPanel?.querySelectorAll('input,select,button').forEach(el => { el.disabled = locked || interpreting; });
            addButton.disabled = kindSelect.disabled = locked || rows.length >= 25;
            saveButton.disabled = locked || !dirty;
            reviewButton.disabled = locked || interpreting || !rows.length;
            const paymentReady = (current.preview?.review.paymentAssertions || []).every(item => paymentAcknowledgements.has(item.actionId));
            confirmButton.disabled = locked || interpreting || dirty || !current.preview || !paymentReady;
            e.belChatPreview.querySelectorAll('input[type="checkbox"]').forEach(el => { el.disabled = locked || interpreting || dirty; });
            reviewButton.hidden = confirmButton.hidden = terminal();
            recoverButton.hidden = !current.pendingSave;
            recoverButton.disabled = !!current.busy;
            interpretationRecovery.hidden = !interpreting; interpretationRecovery.disabled = !!current.busy;
            const enabled = current.capabilities?.interpretation === true;
            e.belChatInput.hidden = instructionButton.hidden = !enabled || terminal();
            e.belChatInput.disabled = instructionButton.disabled = locked || interpreting;
            toolbar.querySelectorAll('[data-lifecycle]').forEach(el => { el.disabled = current.busy || current.pendingSave; });
        }
        async function perform(fn) {
            try { await fn(); } catch (error) {
                if (!disposed) {
                    // Client failures already rendered their recovery state.
                    // Preserve that guidance; local validation still needs a message.
                    if (!current.error || current.error !== error.message) status.textContent = error.message || 'Request failed.';
                    const messages = validationMessages(error.payload?.details, rows);
                    if (messages.length) { const list = node('ul'); messages.forEach(message => list.append(node('li', message))); status.append(list); }
                    showToast(error.message || 'Request failed.', 'error');
                }
            }
        }
        function recordName(record) {
            const v = record.values;
            return [v.displayName || v.name || v.label || label(record.kind), v.crmId, v.email || v.phone, v.startDate || v.dueDate, v.amount !== undefined ? `${v.amount} ${v.currency || ''}` : null, v.status].filter(Boolean).join(' · ');
        }
        function selectedLookups() { return [...lookupSelections.values()]; }
        function renderLookups() {
            if (!lookupPanel) return;
            lookupPanel.replaceChildren();
            if (terminal() || !current.draft?.pendingLookups?.length) return;
            lookupPanel.append(node('h3', 'Find the requested records'), node('p', 'Search exact values, choose a matching record when needed, then continue the instruction.'));
            current.draft.pendingLookups.forEach((lookup, lookupIndex) => {
                const group = node('section', undefined, 'crm-input-lookup');
                group.append(node('h4', `${lookupIndex + 1}. ${label(lookup.kind)}`));
                const selection = lookupSelections.get(lookupIndex), match = selection?.match || lookup;
                const fieldSelect = node('select', undefined, 'crm-input');
                (lookupFields[lookup.kind] || '').split(' ').filter(Boolean).forEach(key => option(fieldSelect, key, label(key)));
                fieldSelect.value = match.field;
                const valueInput = node('input', undefined, 'crm-input'); valueInput.value = match.value; valueInput.maxLength = 128;
                const candidates = node('div', undefined, 'crm-input-search-results');
                const refine = () => { lookupSelections.set(lookupIndex, { lookupIndex, match: { field: fieldSelect.value, value: valueInput.value } }); candidates.replaceChildren(node('p', 'Search again to refresh the matches.')); };
                fieldSelect.addEventListener('change', refine); valueInput.addEventListener('input', refine);
                group.append(field('Search field', fieldSelect), field('Exact value', valueInput), button('Search records', () => perform(async () => {
                    await saveDraft();
                    lookupSelections.set(lookupIndex, { lookupIndex, match: { field: fieldSelect.value, value: valueInput.value } });
                    await client.lookups(selectedLookups().map(({ lookupIndex: index, match: query }) => query ? { lookupIndex: index, match: query } : null).filter(Boolean));
                })));
                const result = current.lookups?.revision === current.draft.revision ? current.lookups.queries.find(query => query.lookupIndex === lookupIndex)?.result : null;
                if (result) {
                    if (result.status === 'not_found') candidates.append(node('p', 'No matching record. Refine the search field or exact value.'));
                    if (result.status === 'refine_query') candidates.append(node('p', 'More matches exist. Refine the search or explicitly select a shown record.'));
                    if (result.status === 'ambiguous') candidates.append(node('p', 'Multiple records match. Choose the intended record.'));
                    const records = result.status === 'resolved' ? [result.record] : result.candidates || [];
                    for (const record of records) {
                        const chosen = selection?.id === record.id;
                        const choose = button(`${chosen ? 'Selected' : 'Choose'}: ${recordName(record)}`, () => {
                            lookupSelections.set(lookupIndex, { lookupIndex, ...(selection?.match ? { match: selection.match } : {}), id: record.id });
                            renderLookups(); controls();
                        });
                        choose.setAttribute('aria-pressed', String(chosen)); candidates.append(choose);
                    }
                }
                group.append(candidates); lookupPanel.append(group);
            });
            lookupPanel.append(button('Continue instruction', () => perform(() => instructionPipeline.continueInstruction(e.belChatInput.value.trim())), true));
        }
        function referenceEditor(row, key, index) {
            const group = node('div', undefined, 'crm-input-reference');
            const select = node('select', undefined, 'crm-input'); option(select, '', 'Choose a record');
            const selected = row.values[key];
            if (selected) option(select, JSON.stringify(selected), typeof selected === 'string' ? recordLabels.get(`${recordKinds[key]}:${selected}`) || 'Previously selected record (review details below)' : 'Selected output from this draft');
            rows.slice(0, index).forEach((prior, i) => {
                if (definitions[prior.kind]?.[2].includes(key)) option(select, JSON.stringify({ $ref: `${prior.actionId}.${key}` }), `${label(key)} from step ${i + 1}: ${definitions[prior.kind][0]}`);
            });
            select.value = selected ? JSON.stringify(selected) : '';
            if (typeof selected === 'string' && selected && !recordLabels.has(`${recordKinds[key]}:${selected}`)) {
                const selectedOption = select.options[select.selectedIndex], selectedOwner = owner;
                selectedOption.textContent = 'Loading selected record…';
                void labelResolver.resolve(recordKinds[key], selected).then(name => {
                    if (disposed || owner !== selectedOwner || getUid() !== selectedOwner || !select.isConnected || row.values[key] !== selected) return;
                    if (name) recordLabels.set(`${recordKinds[key]}:${selected}`, name);
                    selectedOption.textContent = name || 'Record unavailable — find and select it again';
                });
            }
            select.addEventListener('change', () => { row.values[key] = select.value ? JSON.parse(select.value) : null; changed(); });
            group.append(field(label(key), select));
            const search = node('input', undefined, 'crm-input'); search.type = 'search'; search.placeholder = 'Exact name'; search.setAttribute('aria-label', `Find ${label(key).toLowerCase()} by exact name`);
            let teacherSearchField;
            if (key === 'teacherUid') {
                teacherSearchField = node('select', undefined, 'crm-input');
                [['displayName', 'Display name'], ['name', 'Name'], ['email', 'Email']].forEach(([value, title]) => option(teacherSearchField, value, title));
                group.append(field('Find teacher by', teacherSearchField));
                search.placeholder = 'Exact teacher name or email'; search.setAttribute('aria-label', 'Teacher search value');
                group.append(node('p', 'Optional: an empty selection uses the class teacher, or leaves a new personal course unassigned. Existing-class enrollment must use that class’s teacher.'));
            }
            const found = node('div', undefined, 'crm-input-search-results'); found.setAttribute('aria-live', 'polite');
            const find = button('Find', () => perform(async () => {
                const kind = recordKinds[key];
                const query = ['invoice', 'enrollment'].includes(kind)
                    ? { kind, match: { field: 'studentId', value: row.values.studentId } }
                    : { kind, match: { field: teacherSearchField?.value || 'name', value: search.value.trim() } };
                if (typeof query.match.value !== 'string' || !query.match.value) throw new Error(['invoice', 'enrollment'].includes(kind) ? 'Select an existing student first, or choose an output from this draft.' : 'Enter the exact record name.');
                const response = await client.resolve(query);
                const candidates = response.record ? [response.record] : response.candidates || [];
                found.replaceChildren(node('p', candidates.length ? 'Select the matching record:' : 'No accessible matching records.'));
                candidates.forEach(record => found.append(button(recordName(record), () => {
                    recordLabels.set(`${kind}:${record.id}`, recordName(record)); row.values[key] = record.id; changed(); renderRows();
                })));
                if (response.status === 'refine_query') found.append(node('p', 'More records match. Narrow the selection in the CRM before continuing.'));
                controls();
            }));
            if (['invoice', 'enrollment'].includes(recordKinds[key])) find.textContent = `Find for selected student`;
            else group.append(search);
            group.append(find, found); return group;
        }
        function scheduleEditor(row) {
            const group = node('div', undefined, 'crm-input-schedule'); group.append(node('h4', 'Weekly schedule (for a personal course)'));
            (row.values.slots || []).forEach((slot, index) => {
                const line = node('div', undefined, 'crm-input-schedule-row');
                const weekday = node('select', undefined, 'crm-input'); days.forEach((day, i) => option(weekday, String(i), day)); weekday.value = String(slot.weekday);
                const time = node('input', undefined, 'crm-input'); time.type = 'time'; time.value = slot.startTime || '';
                const duration = node('input', undefined, 'crm-input'); duration.type = 'number'; duration.min = '1'; duration.value = slot.durationMinutes || 60;
                weekday.addEventListener('change', () => { slot.weekday = Number(weekday.value); changed(); });
                time.addEventListener('input', () => { slot.startTime = time.value; changed(); });
                duration.addEventListener('input', () => { slot.durationMinutes = duration.value ? Number(duration.value) : null; changed(); });
                line.append(field('Day', weekday), field('Start time', time), field('Minutes', duration), button('Remove slot', () => { row.values.slots.splice(index, 1); changed(); renderRows(); })); group.append(line);
            });
            group.append(button('Add weekly slot', () => { (row.values.slots ||= []).push({ weekday: 1, startTime: '', durationMinutes: 60 }); changed(); renderRows(); })); return group;
        }
        function valueEditor(row, key) {
            if (key === 'contacts') return window.CrmDataInputProfileEditor.createContactsEditor({ doc, row, changed, loadCurrent: async group => {
                const studentId = row.values.studentId, expectedOwner = owner;
                if (typeof studentId !== 'string' || !studentId) throw new Error('Select an existing student before loading contacts.');
                const result = await client.resolve({ kind: 'student', id: studentId });
                if (disposed || owner !== expectedOwner || getUid() !== expectedOwner || row.values.studentId !== studentId || !rows.includes(row)) throw new Error('The selected student changed. Load the contacts again.');
                return window.CrmDataInputProfileEditor.contactListFromContext(result, studentId, group);
            } });
            if (key === 'stage') {
                const input = node('select', undefined, 'crm-input');
                option(input, '', 'Keep current stage (new for a new enquiry)');
                const stages = ['new', 'contacted', 'test_scheduled', 'test_completed', 'counseling', 'trial', 'won', 'lost'];
                stages.forEach(stage => option(input, stage, stage.replaceAll('_', ' ')));
                if (row.values.stage && !stages.includes(row.values.stage)) {
                    option(input, row.values.stage, `${row.values.stage} (current draft value)`); input.options[input.options.length - 1].disabled = true;
                }
                input.value = row.values.stage || '';
                input.addEventListener('change', () => { row.values.stage = input.value || null; changed(); }); return field('Stage', input);
            }
            if (['learningProfile', 'targets'].includes(key)) return window.CrmDataInputProfileEditor.createEditor({ doc, row, group: key, changed });
            if (['preferredLearningDays', 'preferredLearningHours'].includes(key)) {
                const input = node('input', undefined, 'crm-input'); input.type = 'text'; input.placeholder = 'Separate entries with commas';
                input.value = Array.isArray(row.values[key]) ? row.values[key].join(', ') : row.values[key] || '';
                input.addEventListener('input', () => { row.values[key] = parseValue('list', input.value); changed(); }); return field(label(key), input);
            }
            if (key === 'testType') {
                const input = node('select', undefined, 'crm-input');
                option(input, '', 'Choose a test'); option(input, 'entrance_test_36plus_v1', 'Entrance test 36+'); option(input, 'segmental_screening_v1', 'Pronunciation screening');
                input.value = row.values[key] || ''; input.addEventListener('change', () => { row.values[key] = input.value; changed(); }); return field(label(key), input);
            }
            if (key === 'slots') return scheduleEditor(row);
            if (key === 'weekdayNumbers') {
                const group = node('fieldset'); group.append(node('legend', 'Weekdays'));
                days.forEach((day, i) => { const input = node('input'); input.type = 'checkbox'; input.checked = (row.values[key] || []).includes(i); input.addEventListener('change', () => { const set = new Set(row.values[key] || []); if (input.checked) set.add(i); else set.delete(i); row.values[key] = [...set].sort(); changed(); }); group.append(field(day, input)); }); return group;
            }
            const numeric = ['amount', 'discount', 'probability'].includes(key), date = ['dateOfBirth', 'startDate', 'endDate', 'dueDate'].includes(key);
            const input = node(['notes', 'counselingNotes', 'preferredSchedule'].includes(key) ? 'textarea' : 'input', undefined, 'crm-input');
            if (input.tagName === 'INPUT') input.type = numeric ? 'number' : date ? 'date' : key === 'startTime' ? 'time' : 'text';
            if (numeric) input.step = 'any';
            if (key === 'paidAt') { input.placeholder = 'YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+07:00'; input.title = 'Keep the supplied time and UTC offset, or enter only the payment date.'; }
            if (key === 'nextActionAt') { input.placeholder = 'YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+07:00'; input.title = 'Enter the exact follow-up date or include the time and UTC offset.'; }
            input.value = row.values[key] ?? '';
            input.addEventListener('input', () => { row.values[key] = parseValue(numeric ? 'number' : 'text', input.value); changed(); });
            return field(label(key), input);
        }
        function renderRows() {
            form.replaceChildren();
            rows.forEach((row, index) => {
                const section = node('section', undefined, 'crm-input-action'); section.append(node('h3', `${index + 1}. ${definitions[row.kind]?.[0] || row.kind}`));
                for (const key of (definitions[row.kind]?.[1] || '').split(' ').filter(Boolean)) section.append(recordKinds[key] ? referenceEditor(row, key, index) : valueEditor(row, key));
                section.append(button('Remove action', () => { if (current.draft?.actions.some(action => action.actionId === row.actionId)) removed.push(row.actionId); rows.splice(index, 1); changed(); renderRows(); }));
                form.append(section);
            }); controls();
        }
        function readable(value, depth = 0) {
            if (value === null || value === undefined) return node('span', '—');
            if (typeof value !== 'object') return node('span', String(value));
            if (depth > 8) return node('span', 'Additional details');
            const list = node('dl', undefined, 'crm-input-details');
            Object.entries(value).forEach(([key, item]) => { list.append(node('dt', Array.isArray(value) ? `Item ${Number(key) + 1}` : label(key))); const detail = node('dd'); detail.append(readable(item, depth + 1)); list.append(detail); }); return list;
        }
        function renderReview() {
            const nextPaymentReview = current.preview ? `${current.uid}/${current.draft?.draftId}/${current.preview.previewId}` : null;
            if (nextPaymentReview !== paymentReviewIdentity) { paymentReviewIdentity = nextPaymentReview; paymentAcknowledgements.clear(); }
            e.belChatPreview.replaceChildren();
            if (current.receipt) {
                e.belChatPreview.append(node('h3', 'Saved successfully'));
                for (const result of Object.values(current.receipt.results || {})) {
                    if (result?.paymentFollowupRequired?.version === 1) e.belChatPreview.append(node('p', 'Conversion saved. Check the student finance section to complete any required payment details and receipt images.'));
                    for (const [key, label] of [['studentLink', 'Open student'], ['testLink', 'Open entrance test'], ['resultLink', 'Open test result']]) { const href = result && safeLink(result[key], doc.location.origin); if (result?.[key] && href) { const link = node('a', label); link.href = href; link.target = '_blank'; link.rel = 'noopener'; e.belChatPreview.append(link); } }
                }
                return;
            }
            if (!current.preview || dirty) { e.belChatPreview.append(node('p', dirty ? 'Save the draft details, then review changes.' : 'No changes reviewed yet.')); return; }
            e.belChatPreview.append(node('h3', 'Review changes before saving'));
            e.belChatPreview.append(node('p', `Draft revision ${current.preview.review.revision}`));
            if (current.preview.review.actions.some(action => action.kind === 'convertLead')) e.belChatPreview.append(node('p', 'Conversion can proceed without payment details or a receipt image. These remain required follow-up items in the student finance section.'));
            const sources = node('details'); sources.append(node('summary', 'Sources of the proposed fields'));
            for (const [index, action] of (current.preview.review.actions || []).entries()) {
                sources.append(node('h4', `${index + 1}. ${definitions[action.kind]?.[0] || label(action.kind)}`));
                if (action.imageInvolved) sources.append(node('p', 'An image contributed to this action, including any later corrections.'));
                const list = node('dl', undefined, 'crm-input-details');
                for (const source of action.sources || []) list.append(node('dt', label(source.field)), node('dd', { text: 'Text or manual entry', voice: 'Voice', image: 'Image' }[source.kind] || 'Existing draft'));
                sources.append(list);
            }
            e.belChatPreview.append(sources);
            for (const effect of current.preview.review.effects || []) {
                const details = node('details'); details.open = true;
                const operation = effect.operation === 'delete' ? 'Remove' : effect.created ? 'Create' : 'Update';
                const identity = effect.values?.name || effect.values?.crmId || effect.recordId;
                details.append(node('summary', `${label(effect.entityType)} · ${operation} · ${identity}`));
                if (effect.created) details.append(readable(effect.values));
                else if (Array.isArray(effect.changes)) {
                    if (!effect.changes.length) details.append(node('p', 'No visible field values change.'));
                    for (const change of effect.changes) {
                        const section = node('section', undefined, 'crm-input-review-change'); section.append(node('h4', label(change.field)));
                        section.append(node('p', 'Before'), change.beforePresent ? readable(change.before) : node('p', 'Not set'));
                        section.append(node('p', 'After'), change.afterPresent ? readable(change.after) : node('p', 'Not set'));
                        details.append(section);
                    }
                } else details.append(readable(effect.values));
                e.belChatPreview.append(details);
            }
            if (!dirty && current.voiceContext?.confirmationPhrase && client.getVoiceHints().previewId === current.preview.previewId) {
                appendVoiceConfirmations(e.belChatPreview, current.voiceContext);
            }
            for (const assertion of current.preview.review.paymentAssertions || []) {
                const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = paymentAcknowledgements.has(assertion.actionId);
                checkbox.setAttribute('aria-label', `Confirm received payment ${assertion.actionId}`);
                checkbox.addEventListener('change', () => { if (checkbox.checked) paymentAcknowledgements.add(assertion.actionId); else paymentAcknowledgements.delete(assertion.actionId); controls(); });
                const wrapper = node('label'); wrapper.append(checkbox, node('span', `${assertion.actionId}: ${assertion.statement}`)); e.belChatPreview.append(wrapper);
            }
        }
        async function saveDraft() {
            if (!dirty) return;
            saving = true;
            try { const draft = await client.edit(rows.map(({ actionId, kind, values }) => ({ actionId, kind, values })), removed); rows = clone(draft.actions); removed = []; dirty = false; loadedRevision = draft.revision; renderRows(); renderReview(); }
            finally { saving = false; controls(); }
        }
        function stateChanged(state) {
            if (disposed) return;
            current = state;
            const nextLookupIdentity = `${state.uid}/${state.draft?.draftId}/${state.draft?.revision}`;
            if (lookupIdentity !== nextLookupIdentity) { lookupIdentity = nextLookupIdentity; lookupSelections.clear(); }
            let refreshRows = false;
            if (owner !== state.uid) { owner = state.uid; rows = []; removed = []; dirty = false; loadedRevision = null; recordLabels.clear(); labelResolver.clear(); e.belChatInput.value = ''; refreshRows = true; }
            if (!dirty && !saving && loadedRevision !== (state.draft?.revision ?? null)) { rows = clone(state.draft?.actions || []); loadedRevision = state.draft?.revision ?? null; refreshRows = true; }
            status.textContent = state.error || (state.pendingSave ? 'Save response interrupted. Check its status before editing.' : state.busy ? 'Working…' : dirty ? 'Draft has unsaved details.' : state.draft ? `Draft ${state.draft.status}` : 'Start a draft below.');
            const interpretationText = { running: 'Interpreting your instruction…', unknown: 'The interpretation response is uncertain. Check its status before sending again.', rejected: 'The instruction was not applied. Correct it or edit the draft manually.', stale: 'The draft changed before this proposal could be applied. Send an instruction for the current draft.', not_received: 'The instruction did not reach the server. Enter it again.', applied: 'Instruction applied to the draft. Review the changes before saving CRM records.' };
            if (state.interpretation && !terminal()) status.append(node('p', interpretationText[state.interpretation.status] || 'Interpretation status is available.'));
            if (state.draft?.interpretationQuestions?.length && !terminal()) { const list = node('ul'); state.draft.interpretationQuestions.forEach(question => list.append(node('li', question.text))); status.append(list); }
            if (state.interpretation?.status === 'applied' && e.belChatInput.value.trim() === state.interpretation.text?.trim()) e.belChatInput.value = '';
            intro.textContent = terminal() ? 'Start a new draft to make further CRM changes.' : state.capabilities?.interpretation ? 'Describe the CRM changes or edit the draft below. Review the complete changes before confirming the save.' : 'Edit CRM records in a draft, review the complete changes, then confirm to save. AI and voice input are not available in this local build.';
            if (refreshRows) renderRows();
            history.replaceChildren(); for (const message of state.messages) history.append(node('p', message.text));
            attachmentPanel?.render(state); renderLookups(); renderReview(); controls(); voicePanel?.refresh();
            if (terminal()) void voicePanel?.stop(); else void voiceBridge?.sync();
            if (!injectedVoiceTransport && state.capabilities?.voice === false) void voicePanel?.stop();
            if (budgetPanel) {
                const eligible = state.capabilities?.budget === true, priorEligible = budgetPanel.getState().eligible;
                budgetPanel.setAccount(state.uid); void budgetPanel.setEligible(eligible);
                if (wasBusy && !state.busy && eligible && priorEligible) void budgetPanel.refresh();
            }
            wasBusy = state.busy;
        }
        function init() {
            e.belChatThread.replaceChildren();
            status = node('div'); status.setAttribute('role', 'status');
            history = node('div', undefined, 'crm-input-history'); form = node('div'); toolbar = node('div', undefined, 'crm-input-toolbar'); lookupPanel = node('div');
            kindSelect = node('select', undefined, 'crm-input'); kindSelect.setAttribute('aria-label', 'Action to add'); Object.entries(definitions).forEach(([key, definition]) => option(kindSelect, key, definition[0]));
            addButton = button('Add action', () => { rows.push({ actionId: crypto.randomUUID(), kind: kindSelect.value, values: {} }); changed(); renderRows(); });
            saveButton = button('Save draft details', () => perform(saveDraft));
            reviewButton = e.belChatSend; reviewButton.textContent = 'Review changes';
            confirmButton = e.belChatApply; confirmButton.textContent = 'Confirm and save';
            recoverButton = button('Check save status', () => perform(() => client.recover()));
            interpretationRecovery = button('Check interpretation', () => perform(() => client.recoverInterpretation()));
            instructionButton = button('Send instruction', () => perform(async () => { const text = e.belChatInput.value.trim(); if (!text) throw new Error('Enter an instruction first.'); await saveDraft(); await client.interpret(text, selectedLookups()); }), true);
            e.belChatInput.setAttribute('aria-label', 'Instruction'); e.belChatInput.maxLength = 16000;
            e.belChatInput.style.minHeight = '64px'; e.belChatInput.style.maxHeight = '140px';
            e.belChatInput.placeholder = 'Describe an enquiry, student update, enrollment or payment…';
            e.belChatInput.after(instructionButton);
            const discard = button('Discard draft', () => perform(async () => { await client.discard(); rows = []; removed = []; dirty = false; renderRows(); renderReview(); })); discard.dataset.lifecycle = 'true';
            const fresh = button('New draft', () => perform(async () => { if (dirty) throw new Error('Save or discard the current draft details first.'); await client.newConversation(); })); fresh.dataset.lifecycle = 'true';
            toolbar.append(kindSelect, addButton, saveButton, recoverButton, interpretationRecovery, discard, fresh);
            e.belChatThread.append(status, history, toolbar, lookupPanel, form);
            e.belChatInput.hidden = true;
            intro = node('p', '', 'crm-muted'); e.belChatThread.prepend(intro);
            client = window.CrmDataInputClient.createClient({ request, getUid, storage: window.localStorage, onChange: stateChanged });
            instructionPipeline = createInstructionPipeline({ client, getUid, saveDraft, getSelections: selectedLookups, isDirty: () => dirty,
                getNavigationKey: () => disposed ? 'disposed' : getActivePanel() });
            const attachmentHost = node('div'); e.belChatThread.insertBefore(attachmentHost, lookupPanel);
            attachmentPanel = window.CrmDataInputAttachments.createPanel({ host: attachmentHost, client, perform, beforeUpload: saveDraft,
                interpretImage: async attachmentId => {
                    const text = e.belChatInput.value.trim();
                    if (!text) throw new Error('Enter an instruction for the image first.');
                    await saveDraft(); await client.interpret(text, selectedLookups(), attachmentId);
                } });
            listen(e.belChatLauncher, 'click', () => { e.belChatDrawer.style.display = 'block'; e.belChatDrawer.setAttribute('aria-hidden', 'false'); e.belChatClose.focus(); perform(async () => { await client.capabilities(); if (!client.getState().draft) await client.resume(); else if (client.getState().capabilities.attachments) await client.refreshAttachments(); }); });
            const voiceHost = node('div'); e.belChatThread.insertBefore(voiceHost, attachmentHost);
            voiceBridge = createVoiceBridge({ client, getUid, isDirty: () => dirty,
                transport: { updateContext: () => voiceTransport?.updateContext?.() }, onContextError: () => { void voicePanel?.stop(); } });
            if (!voiceTransport && initialCapabilities.voice === true && initialCapabilities.voiceRelayUrl && typeof getIdToken === 'function' && window.CrmAiVoiceTransport) {
                voiceTransport = window.CrmAiVoiceTransport.createTransport({ getUid, getIdToken, getContext: voiceBridge.getContext, baseUrl: initialCapabilities.voiceRelayUrl,
                    workletUrl: '/js/crm/ai-assistance/voice-audio-worklet.js?v=20260908-459cca59' });
            }
            voicePanel = window.CrmDataInputVoicePanel.createPanel({ host: voiceHost, instruction: e.belChatInput, transport: voiceTransport, getUid, perform,
                onConfirmation: initialCapabilities.voice === true ? voiceBridge.confirm : undefined,
                onSpokenInstruction: initialCapabilities.interpretation === true ? instructionPipeline.spoken : undefined,
                canStart: () => (current.capabilities?.voice === true || injectedVoiceTransport && current.capabilities?.interpretation === true) && !current.busy && !current.pendingSave && !terminal() });
            if (window.CrmAiBudget) {
                const budgetHost = node('section'); e.belChatThread.insertBefore(budgetHost, voiceHost);
                budgetPanel = window.CrmAiBudget.createController({ root: budgetHost, endpoint: '/api/admin/data-input/budget', apiFetchJson: request, getCurrentUser: () => ({ uid: getUid() }) });
                budgetPanel.init();
            }
            const close = () => { void voicePanel.stop(); attachmentPanel.clearPreview(); e.belChatDrawer.style.display = 'none'; e.belChatDrawer.setAttribute('aria-hidden', 'true'); e.belChatLauncher.focus(); };
            listen(e.belChatClose, 'click', close);
            listen(e.belChatDrawer, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
            listen(reviewButton, 'click', () => perform(async () => { await saveDraft(); await client.review(); }));
            listen(confirmButton, 'click', () => perform(() => client.commit([...paymentAcknowledgements])));
            stateChanged(client.getState()); onRouteChange();
        }
        function onRouteChange() { if (client) client.refreshIdentity(); voicePanel?.refresh(); e.belChatContext.textContent = getActivePanel() || 'CRM data input'; }
        return { init, onRouteChange, dispose() { disposed = true; labelResolver.clear(); listeners.forEach(remove => remove()); instructionButton?.remove(); attachmentPanel?.dispose(); voicePanel?.dispose(); budgetPanel?.setAccount(''); } };
    }
    return { createController, createVoiceBridge, createSpokenInstructionHandler, createInstructionPipeline, createRecordLabelResolver, appendVoiceConfirmations, safeLink, parseValue, validationMessages };
})();
