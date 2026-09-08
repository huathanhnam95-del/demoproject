window.CrmStudentFinance = (function () {
    function createController(deps = {}) {
        const {
            apiFetchJson,
            elements,
            modalState,
            isActiveStudentSession,
            getCurrentStudentProfile,
            renderStudentSchedulePrompt,
            refreshDashboard,
            showToast,
            escapeHtml,
            getAdminCapabilities
        } = deps;
        let followupRequest = 0;
        let pendingPaymentIntent = null;
        function newPaymentOperationId() {
            if (typeof window.crypto?.randomUUID === 'function') return window.crypto.randomUUID();
            return `manual-payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        }
        function paymentBodyWithoutRetryMetadata(body) {
            const comparable = { ...(body || {}) };
            delete comparable.operationId;
            delete comparable.paymentDate;
            return comparable;
        }
        function samePaymentIntent(left, right) {
            return JSON.stringify(paymentBodyWithoutRetryMetadata(left))
                === JSON.stringify(paymentBodyWithoutRetryMetadata(right));
        }
        function paymentActorUid() {
            return String(window.firebase?.auth?.().currentUser?.uid || '').trim();
        }
        function resetPaymentIntent() {
            pendingPaymentIntent = null;
        }
        function followupHost(key, anchor) {
            if (!anchor) return null;
            if (!elements[key]) {
                const host = anchor.ownerDocument.createElement('div');
                host.setAttribute('aria-live', 'polite');
                anchor.insertAdjacentElement('afterend', host); elements[key] = host;
            }
            return elements[key];
        }
        async function refreshPaymentFollowup(studentId) {
            const request = ++followupRequest, sessionKey = modalState.studentSessionKey;
            const uid = window.firebase?.auth?.().currentUser?.uid;
            const active = () => request === followupRequest && modalState.studentId === studentId
                && modalState.studentSessionKey === sessionKey && window.firebase?.auth?.().currentUser?.uid === uid;
            const note = followupHost('studentPaymentFollowupNote', elements.studentModalTitle);
            const host = followupHost('studentPaymentEvidence', elements.studentFinanceWorkflowNote);
            if (note) { note.hidden = false; note.textContent = 'Checking payment follow-up…'; }
            if (host) { host.replaceChildren(); host.hidden = true; }
            try {
                const status = await apiFetchJson(`/api/admin/students/${encodeURIComponent(studentId)}/payment-followup`);
                if (!active()) return;
                if (note) {
                    note.hidden = !status.required;
                    note.textContent = !status.required ? '' : status.paymentStatus === 'not_recorded'
                        ? 'Required follow-up: no payment is recorded yet. Complete payment details and attach the receipt in Finance. Conversion is saved.'
                        : status.evidenceStatus === 'missing'
                            ? 'Required follow-up: payment is recorded; a receipt image is still missing. Add it in Finance.'
                            : 'Payment details and receipt images are complete. See Finance for current invoice balances.';
                    if (status.required && status.requiredActions.length) {
                        const open = note.ownerDocument.createElement('button'); open.type = 'button'; open.className = 'crm-btn-secondary'; open.textContent = 'Open Finance';
                        open.addEventListener('click', () => { if (active()) Array.from(elements.studentSidebarItems || []).find(item => item.dataset.tab === 'finance')?.click(); });
                        note.append(open);
                    }
                }
                if (!host) return;
                host.hidden = !status.required && !status.payments.length;
                const doc = host.ownerDocument, heading = doc.createElement('h4'); heading.textContent = 'Payment receipt images'; host.append(heading);
                const explanation = doc.createElement('p');
                explanation.textContent = status.paymentStatus === 'not_recorded'
                    ? 'Record the actual payment using the payment form below, then attach its receipt. An image alone does not record money.'
                    : 'Receipt images document recorded payments. They do not independently verify bank receipt or change invoice balances.';
                host.append(explanation);
                for (const payment of status.payments) {
                    const row = doc.createElement('div'), label = doc.createElement('p');
                    label.textContent = `Payment ${payment.paymentId}: ${payment.amount} ${payment.currency || ''} — ${payment.evidencePresent ? 'receipt attached' : 'receipt missing'}`; row.append(label);
                    const message = doc.createElement('p'); message.setAttribute('role', 'status');
                    const action = doc.createElement('button'); action.type = 'button'; action.className = 'crm-btn-secondary';
                    if (payment.evidencePresent) {
                        action.textContent = 'View receipt';
                        action.addEventListener('click', async () => {
                            if (!active()) return; action.disabled = true;
                            try {
                                const blob = await apiFetchJson(`/api/admin/payments/${encodeURIComponent(payment.paymentId)}/evidence`, { responseType: 'blob' });
                                if (!active()) return;
                                const image = doc.createElement('img'), url = URL.createObjectURL(blob);
                                image.alt = `Receipt for payment ${payment.paymentId}`; image.style.maxWidth = '100%'; image.style.maxHeight = '360px';
                                image.onload = image.onerror = () => URL.revokeObjectURL(url); image.src = url; row.append(image); action.hidden = true;
                            } catch (error) { if (active()) message.textContent = error?.message || 'Receipt could not be loaded.'; }
                            finally { if (active()) action.disabled = false; }
                        });
                    } else {
                        const input = doc.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.setAttribute('aria-label', `Receipt image for payment ${payment.paymentId}`); row.append(input);
                        const preview = doc.createElement('img'); preview.alt = 'Selected receipt image preview'; preview.hidden = true; preview.style.maxWidth = '100%'; preview.style.maxHeight = '260px';
                        const notice = doc.createElement('p'); notice.textContent = 'Review this image before attaching it. The first receipt is preserved; a different image cannot replace it here.';
                        const reviewed = doc.createElement('input'); reviewed.type = 'checkbox'; reviewed.setAttribute('aria-label', `Reviewed receipt for payment ${payment.paymentId}`);
                        const reviewLabel = doc.createElement('label'); reviewLabel.append(reviewed, doc.createTextNode(' I checked that this is the correct receipt for this payment.'));
                        input.addEventListener('change', () => {
                            reviewed.checked = false; preview.hidden = true;
                            const image = input.files?.[0]; if (!image) return;
                            const url = URL.createObjectURL(image); preview.onload = preview.onerror = () => URL.revokeObjectURL(url); preview.src = url; preview.hidden = false;
                        });
                        row.append(notice, preview, reviewLabel);
                        action.textContent = 'Attach receipt';
                        action.addEventListener('click', async () => {
                            if (!active()) return;
                            const image = input.files?.[0]; if (!image) { message.textContent = 'Choose a receipt image first.'; return; }
                            if (!reviewed.checked) { message.textContent = 'Preview the selected image and confirm it is the correct receipt.'; return; }
                            action.disabled = input.disabled = true;
                            try {
                                await apiFetchJson(`/api/admin/payments/${encodeURIComponent(payment.paymentId)}/evidence`, { method: 'PUT', headers: { 'Content-Type': image.type }, body: image });
                                if (active()) await refreshPaymentFollowup(studentId);
                            } catch (error) { if (active()) message.textContent = error?.message || 'Receipt upload failed. Retry the same image.'; }
                            finally { if (active()) action.disabled = input.disabled = false; }
                        });
                    }
                    row.append(action, message); host.append(row);
                }
            } catch (error) {
                if (active() && note) { note.hidden = false; note.textContent = error?.message || 'Payment follow-up could not be checked. Reopen Finance to retry.'; }
            }
        }

        function hasCapability(name) {
            const capabilities = typeof getAdminCapabilities === 'function'
                ? (getAdminCapabilities() || {})
                : {};
            return capabilities[name] === true;
        }

        function getSelectedClassroomMatch() {
            const matches = Array.isArray(modalState.classroomMatches) ? modalState.classroomMatches : [];
            const selectedId = String(elements.inputStudentClassroomMatchSelect?.value || '').trim();
            return matches.find((match) => String(match.classroomId || '') === selectedId) || matches[0] || null;
        }

        function renderWorkflow(workflow) {
            if (!elements.studentFinanceWorkflowBadge || !elements.studentFinanceWorkflowNote) return;
            const state = workflow || {};
            const action = String(state.nextAction || 'collect_payment');
            const tone = action === 'collect_payment'
                ? 'low'
                : 'medium';

            elements.studentFinanceWorkflowBadge.className = `crm-task-priority ${tone}`;
            elements.studentFinanceWorkflowBadge.textContent = action.replace(/_/g, ' ');
            elements.studentFinanceWorkflowNote.textContent = String(state.message || 'Follow the finance workflow guidance.');
        }

        function formatGroupedMoney(totalValue, currencyTotals, key) {
            const buckets = Array.isArray(currencyTotals) ? currencyTotals : [];
            if (!buckets.length) {
                return window.CrmFinance ? window.CrmFinance.formatMoney(totalValue || 0, 'VND') : String(totalValue || 0);
            }
            return buckets.map((bucket) => {
                const currency = String(bucket.currency || 'VND').toUpperCase();
                const amount = Number(bucket?.[key] || 0);
                const formatted = window.CrmFinance
                    ? window.CrmFinance.formatMoney(amount, currency)
                    : String(amount);
                return `${currency} ${formatted}`;
            }).join(' | ');
        }

        function renderMatches(matchPayload = {}) {
            const matches = Array.isArray(matchPayload.matches) ? matchPayload.matches : [];
            modalState.classroomMatches = matches;
            const unsupported = !!matchPayload.unsupported;
            const temporaryIssue = !!matchPayload.error && !unsupported;

            if (elements.studentClassroomMatchSummary) {
                if (unsupported) {
                    elements.studentClassroomMatchSummary.innerHTML = '<div class="crm-muted">Classroom recommendations are unavailable on this server.</div>';
                } else if (temporaryIssue) {
                    elements.studentClassroomMatchSummary.innerHTML = '<div class="crm-muted">Classroom recommendations are temporarily unavailable.</div>';
                } else if (!matches.length) {
                    elements.studentClassroomMatchSummary.innerHTML = '<div class="crm-muted">No active classrooms found.</div>';
                } else {
                    elements.studentClassroomMatchSummary.innerHTML = matches.slice(0, 4).map((match) => {
                        const reasons = Array.isArray(match.reasons) ? match.reasons : [];
                        const warnings = Array.isArray(match.warnings) ? match.warnings : [];
                        const dayText = Array.isArray(match.meetingDays) && match.meetingDays.length ? `Days: ${match.meetingDays.join(', ')}` : '';
                        const hourText = Array.isArray(match.meetingHours) && match.meetingHours.length ? `Hours: ${match.meetingHours.join(', ')}` : '';
                        const metadata = [match.courseId || 'No course', dayText, hourText].filter(Boolean).join(' | ');
                        return `
            <div class="crm-task-item" data-classroom-id="${escapeHtml(match.classroomId || '')}">
              <div class="crm-task-head">
                <strong>${escapeHtml(match.name || 'Classroom')}</strong>
                <span class="crm-task-priority ${match.recommended ? 'medium' : 'low'}">${escapeHtml(`${Number(match.fitScore || 0)}% fit`)}</span>
              </div>
              <div class="crm-task-meta">${escapeHtml(metadata)}</div>
              ${reasons.length ? `<div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(reasons.join(' | '))}</div>` : ''}
              ${warnings.length ? `<div class="crm-muted" style="margin-top: 6px;">${escapeHtml(warnings.join(' | '))}</div>` : ''}
            </div>
          `;
                    }).join('');
                }
            }

            if (elements.inputStudentClassroomMatchSelect) {
                const currentValue = String(elements.inputStudentClassroomMatchSelect.value || '').trim();
                const recommendedId = String(matchPayload.recommendedClassroom?.classroomId || matches[0]?.classroomId || '').trim();
                elements.inputStudentClassroomMatchSelect.innerHTML = '<option value="">No classroom selected</option>' + matches.map((match) => `
        <option value="${escapeHtml(match.classroomId || '')}">${escapeHtml([match.name || 'Classroom', match.courseId || 'course?', `${Number(match.fitScore || 0)}% fit`].join(' | '))}${match.recommended ? ' (recommended)' : ''}</option>
      `).join('');
                if (currentValue && matches.some((match) => String(match.classroomId || '') === currentValue)) {
                    elements.inputStudentClassroomMatchSelect.value = currentValue;
                } else if (recommendedId) {
                    elements.inputStudentClassroomMatchSelect.value = recommendedId;
                }
            }

            if (elements.studentClassroomMatchMeta) {
                const classroomCount = Number(matchPayload.classroomCount || matches.length || 0);
                const recommended = matchPayload.recommendedClassroom || matches[0] || null;
                elements.studentClassroomMatchMeta.textContent = unsupported
                    ? 'Upgrade the admin backend to enable classroom-fit recommendations.'
                    : temporaryIssue
                    ? 'Classroom recommendations are temporarily unavailable.'
                    : classroomCount
                    ? `Ranked ${classroomCount} active classroom${classroomCount === 1 ? '' : 's'}. Recommended: ${recommended?.name || 'Classroom'} (${Number(recommended?.fitScore || 0)}%).`
                    : 'No active classrooms found for this student.';
            }

            const selected = getSelectedClassroomMatch();
            if (elements.studentClassroomMatchWarning) {
                if (!selected) {
                    elements.studentClassroomMatchWarning.textContent = unsupported
                        ? 'The current server does not expose classroom recommendation data.'
                        : temporaryIssue
                        ? 'Classroom recommendations are temporarily unavailable.'
                        : '';
                    elements.studentClassroomMatchWarning.style.color = '';
                } else if (modalState.financeWorkflow?.nextAction === 'start_attendance') {
                    elements.studentClassroomMatchWarning.textContent = 'Student already has an active enrollment. Continue with attendance and class delivery.';
                    elements.studentClassroomMatchWarning.style.color = '#15803d';
                } else if (modalState.financeWorkflow?.requiresPayment) {
                    elements.studentClassroomMatchWarning.textContent = 'Payment confirmation is required before creating the enrollment.';
                    elements.studentClassroomMatchWarning.style.color = '#b45309';
                } else if (selected.recommended) {
                    elements.studentClassroomMatchWarning.textContent = `Recommended match confirmed: ${selected.name || 'Classroom'} (${Number(selected.fitScore || 0)}% fit).`;
                    elements.studentClassroomMatchWarning.style.color = '#15803d';
                } else {
                    const top = matches[0] || null;
                    elements.studentClassroomMatchWarning.textContent = top
                        ? `Manual override selected. Top recommendation is ${top.name || 'Classroom'} (${Number(top.fitScore || 0)}% fit).`
                        : 'Manual override selected.';
                    elements.studentClassroomMatchWarning.style.color = '#b45309';
                }
            }

            if (elements.btnCreateRecommendedEnrollment) {
                elements.btnCreateRecommendedEnrollment.disabled = unsupported
                    || temporaryIssue
                    || !selected
                    || !!modalState.financeWorkflow?.requiresPayment
                    || modalState.financeWorkflow?.nextAction === 'start_attendance';
            }
        }

        async function refreshStudentFinance(session = null) {
            const studentId = String(session?.studentId || modalState.studentId || '').trim();
            if (!studentId) return;
            if (session && typeof isActiveStudentSession === 'function' && !isActiveStudentSession(session)) return;
            const requestSession = session || { studentId, key: modalState.studentSessionKey };
            const requestGeneration = Number(modalState.studentFinanceRequestGeneration || 0) + 1;
            modalState.studentFinanceRequestGeneration = requestGeneration;
            const restoreFocus = !!modalState.studentFinanceFocusPending;
            modalState.studentFinanceFocusPending = false;
            const focusAfterReplacement = (target) => {
                if (!restoreFocus || (document.activeElement !== document.body && document.activeElement !== document.documentElement)) return;
                if (target && target.isConnected && target.getClientRects().length) target.focus();
            };
            if (elements.studentFinanceWorkflowNote && !elements.studentFinanceWorkflowNote.hasAttribute('tabindex')) elements.studentFinanceWorkflowNote.setAttribute('tabindex', '-1');
            const active = () => (typeof isActiveStudentSession === 'function'
                ? isActiveStudentSession(requestSession)
                : String(modalState.studentId || '').trim() === studentId
                    && Number(modalState.studentSessionKey || 0) === Number(requestSession.key || 0))
                && Number(modalState.studentFinanceRequestGeneration || 0) === requestGeneration;
            const statusAttributes = (element) => {
                if (!element) return null;
                if (!element.__crmFinanceStatusAttributes) {
                    element.__crmFinanceStatusAttributes = {
                        role: element.getAttribute('role'),
                        ariaLive: element.getAttribute('aria-live'),
                        ariaAtomic: element.getAttribute('aria-atomic')
                    };
                }
                return element.__crmFinanceStatusAttributes;
            };
            const restoreStatusAttributes = (element) => {
                const original = element?.__crmFinanceStatusAttributes;
                if (!element || !original) return;
                ['role', 'aria-live', 'aria-atomic'].forEach((attribute) => element.removeAttribute(attribute));
                if (original.role !== null) element.setAttribute('role', original.role);
                if (original.ariaLive !== null) element.setAttribute('aria-live', original.ariaLive);
                if (original.ariaAtomic !== null) element.setAttribute('aria-atomic', original.ariaAtomic);
            };
            const addRetry = (container, id, label = 'Retry') => {
                if (!container || !active()) return;
                const button = container.ownerDocument.createElement('button');
                button.type = 'button';
                button.id = id;
                button.className = 'crm-btn-secondary';
                button.textContent = label;
                button.addEventListener('click', async () => {
                    if (!active()) return;
                    modalState.studentFinanceFocusPending = document.activeElement === button;
                    button.disabled = true;
                    try {
                        await refreshStudentFinance(session);
                    } catch (error) {
                        if (active()) showToast(error?.message || 'Finance refresh failed. Retry.', 'error');
                    }
                });
                container.append(container.ownerDocument.createTextNode(' '), button);
            };
            const setSectionStatus = (element, message, retryId = null) => {
                if (!element || !active()) return;
                statusAttributes(element);
                element.removeAttribute('aria-busy');
                element.setAttribute('role', 'alert');
                element.setAttribute('aria-live', 'assertive');
                element.setAttribute('aria-atomic', 'true');
                element.textContent = String(message || '');
                if (retryId) addRetry(element, retryId);
            };
            const setLoadingState = () => {
                if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = 'Loading…';
                if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = 'Loading…';
                if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = 'Loading…';
                if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = 'Loading…';
                if (elements.studentFinanceEnrollmentMeta) elements.studentFinanceEnrollmentMeta.textContent = 'Loading enrollment context…';
                if (elements.studentInvoiceList) elements.studentInvoiceList.innerHTML = '<div class="crm-muted">Loading finance summary…</div>';
                if (elements.studentClassroomMatchSummary) {
                    restoreStatusAttributes(elements.studentClassroomMatchSummary);
                    elements.studentClassroomMatchSummary.innerHTML = '<div class="crm-muted">Loading classroom recommendations…</div>';
                    elements.studentClassroomMatchSummary.setAttribute('aria-busy', 'true');
                }
                if (elements.studentClassroomMatchMeta) elements.studentClassroomMatchMeta.textContent = 'Loading classroom recommendations…';
                if (elements.btnCreateRecommendedEnrollment) elements.btnCreateRecommendedEnrollment.disabled = true;
                if (elements.studentFinanceWorkflowNote) {
                    restoreStatusAttributes(elements.studentFinanceWorkflowNote);
                    elements.studentFinanceWorkflowNote.setAttribute('aria-busy', 'true');
                    elements.studentFinanceWorkflowNote.textContent = 'Loading finance summary…';
                }
            };
            const setUnavailableValues = () => {
                if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = 'Unavailable';
                if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = 'Unavailable';
                if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = 'Unavailable';
                if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = 'Unavailable';
                if (elements.studentFinanceEnrollmentMeta) elements.studentFinanceEnrollmentMeta.textContent = 'Finance data is unavailable.';
                if (elements.studentInvoiceList) elements.studentInvoiceList.innerHTML = '<div class="crm-muted">Finance data is unavailable.</div>';
            };
            const renderInvoiceList = (invoices) => {
                if (!elements.studentInvoiceList) return;
                if (!invoices.length) {
                    elements.studentInvoiceList.innerHTML = '<div class="crm-muted">No invoices yet.</div>';
                } else {
                    elements.studentInvoiceList.innerHTML = invoices.map((invoice) => `
          <div class="crm-task-item">
            <div class="crm-task-head">
              <strong>Invoice ${escapeHtml(invoice.invoiceId || '')}</strong>
              <span class="crm-task-priority medium">${escapeHtml(invoice.status || 'open')}</span>
            </div>
            <div class="crm-task-meta">Due ${escapeHtml(String(invoice.dueDate || '-'))}</div>
            <div class="crm-timeline-meta" style="margin-top: 6px;">Net ${escapeHtml(window.CrmFinance ? window.CrmFinance.formatMoney(invoice.netAmount) : String(invoice.netAmount || 0))} | Outstanding ${escapeHtml(window.CrmFinance ? window.CrmFinance.formatMoney(invoice.outstandingAmount) : String(invoice.outstandingAmount || 0))}</div>
            <div class="crm-task-actions">
              <button type="button" class="crm-btn-secondary btn-select-invoice" data-invoice-id="${escapeHtml(invoice.invoiceId || '')}">Select</button>
            </div>
          </div>
        `).join('');
                }
            };
            setLoadingState();
            await refreshPaymentFollowup(studentId);
            if (!active()) return;

            if (elements.studentInvoiceList && !elements.studentInvoiceList.__crmInvoiceSelectHandlerBound) {
                elements.studentInvoiceList.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('.btn-select-invoice')
                        : null;
                    if (!button || !elements.studentInvoiceList.contains(button)) return;
                    const nextInvoiceId = String(button.dataset.invoiceId || '').trim();
                    if (pendingPaymentIntent && pendingPaymentIntent.invoiceId !== nextInvoiceId) resetPaymentIntent();
                    modalState.selectedInvoiceId = nextInvoiceId;
                    showToast(`Selected ${modalState.selectedInvoiceId} for payment.`, 'success');
                });
                elements.studentInvoiceList.__crmInvoiceSelectHandlerBound = true;
            }

            const financeSummaryPromise = window.CrmFinance
                ? apiFetchJson(`/api/admin/finance/summary?studentId=${encodeURIComponent(studentId)}`, {
                    method: 'GET'
                })
                : Promise.resolve({
                    totalInvoiced: 0,
                    totalPaid: 0,
                    totalOutstanding: 0,
                    nextDueDate: '-',
                    invoices: []
                });
            const attendanceSummaryPromise = window.ClassroomAPI && typeof window.ClassroomAPI.fetchAttendanceSummary === 'function'
                ? Promise.resolve().then(() => window.ClassroomAPI.fetchAttendanceSummary({ studentId }))
                : Promise.resolve({ students: [] });
            const [financeSummaryResult, attendanceSummaryResult] = await Promise.allSettled([
                financeSummaryPromise,
                attendanceSummaryPromise
            ]);
            if (!active()) return;
            const summaryError = financeSummaryResult.status === 'rejected';
            const attendanceError = attendanceSummaryResult.status === 'rejected';
            const json = summaryError ? null : financeSummaryResult.value;
            const attendanceJson = attendanceError ? null : attendanceSummaryResult.value;
            const totalInvoiced = Number(json?.totalInvoiced || 0);
            const totalPaid = Number(json?.totalPaid || 0);
            const totalOutstanding = Number(json?.totalOutstanding || 0);
            const nextDueDate = String(json?.nextDueDate || '').trim() || '-';
            const invoices = Array.isArray(json?.invoices) ? json.invoices : [];
            const currencyTotals = Array.isArray(json?.currencyTotals) ? json.currencyTotals : [];
            const enrollmentRows = Array.isArray(attendanceJson?.students) ? attendanceJson.students : [];
            const activeEnrollments = enrollmentRows.filter((row) => String(row.status || '') === 'active');
            const availableEnrollments = activeEnrollments.length ? activeEnrollments : enrollmentRows;
            const currentEnrollmentId = String(elements.inputStudentFinanceEnrollment?.value || '').trim();
            const currentEnrollment = currentEnrollmentId
                ? availableEnrollments.find((row) => String(row.enrollmentId || '') === currentEnrollmentId)
                : null;
            const classroomMatchCourseId = String(currentEnrollment?.courseId || availableEnrollments[0]?.courseId || '').trim();

            const classroomMatchesPromise = !summaryError && !attendanceError && hasCapability('classroomMatches')
                && window.ClassroomAPI
                && typeof window.ClassroomAPI.fetchClassroomMatches === 'function'
                ? Promise.resolve().then(() => window.ClassroomAPI.fetchClassroomMatches(studentId, classroomMatchCourseId ? { courseId: classroomMatchCourseId } : {})).catch(() => ({
                    matches: [],
                    recommendedClassroom: null,
                    classroomCount: 0,
                    courseId: null,
                    error: true
                }))
                : Promise.resolve(summaryError || attendanceError
                    ? {
                        matches: [],
                        recommendedClassroom: null,
                        classroomCount: 0,
                        courseId: null,
                        error: true
                    }
                    : {
                        matches: [],
                        recommendedClassroom: null,
                        classroomCount: 0,
                        courseId: null,
                        unsupported: true
                    });

            const classroomMatchesJson = await classroomMatchesPromise;
            if (!active()) return;
            if (summaryError || attendanceError) {
                if (summaryError) {
                    setUnavailableValues();
                    if (elements.studentFinanceWorkflowBadge) {
                        elements.studentFinanceWorkflowBadge.className = 'crm-task-priority low';
                        elements.studentFinanceWorkflowBadge.textContent = 'unavailable';
                    }
                    setSectionStatus(elements.studentFinanceWorkflowNote, 'Finance summary is unavailable.', 'btn-retry-student-finance');
                    setSectionStatus(elements.studentClassroomMatchSummary, 'Classroom recommendations are unavailable until Finance is refreshed.', 'btn-retry-student-classroom-matches');
                } else {
                    if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = formatGroupedMoney(totalInvoiced, currencyTotals, 'totalInvoiced');
                    if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = formatGroupedMoney(totalPaid, currencyTotals, 'totalPaid');
                    if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = formatGroupedMoney(totalOutstanding, currencyTotals, 'totalOutstanding');
                    if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = nextDueDate;
                    if (elements.studentFinanceEnrollmentMeta) elements.studentFinanceEnrollmentMeta.textContent = 'Attendance data is unavailable.';
                    renderInvoiceList(invoices);
                    if (elements.studentFinanceWorkflowBadge) {
                        elements.studentFinanceWorkflowBadge.className = 'crm-task-priority low';
                        elements.studentFinanceWorkflowBadge.textContent = 'unavailable';
                    }
                    setSectionStatus(elements.studentFinanceWorkflowNote, 'Attendance summary is unavailable.', 'btn-retry-student-finance');
                    setSectionStatus(elements.studentClassroomMatchSummary, 'Classroom recommendations are unavailable until attendance is refreshed.', 'btn-retry-student-classroom-matches');
                }
                if (elements.studentClassroomMatchMeta) elements.studentClassroomMatchMeta.textContent = 'Classroom recommendations are unavailable.';
                focusAfterReplacement(elements.studentFinanceWorkflowNote);
                return;
            }

            const financeWorkflow = !summaryError && window.CrmFinance && typeof window.CrmFinance.deriveWorkflowState === 'function'
                ? window.CrmFinance.deriveWorkflowState({
                    invoices,
                    enrollments: availableEnrollments,
                    matches: Array.isArray(classroomMatchesJson?.matches) ? classroomMatchesJson.matches : []
                })
                : {
                    nextAction: 'collect_payment',
                    requiresPayment: true,
                    primaryClassroomId: null,
                    activeEnrollmentId: null,
                    message: 'Finance workflow guidance is unavailable.'
                };

            modalState.financeEnrollments = availableEnrollments;
            modalState.financeWorkflow = financeWorkflow;

            if (elements.inputStudentFinanceEnrollment) {
                const currentValue = String(elements.inputStudentFinanceEnrollment.value || '').trim();
                elements.inputStudentFinanceEnrollment.innerHTML = '<option value="">No enrollment selected</option>' + availableEnrollments.map((row) => `
        <option value="${escapeHtml(row.enrollmentId || '')}">${escapeHtml([row.classId || 'class?', row.courseId || 'course?', row.status || 'status?'].join(' | '))}</option>
      `).join('');

                if (currentValue && availableEnrollments.some((row) => String(row.enrollmentId || '') === currentValue)) {
                    elements.inputStudentFinanceEnrollment.value = currentValue;
                } else if (availableEnrollments.length === 1) {
                    elements.inputStudentFinanceEnrollment.value = String(availableEnrollments[0].enrollmentId || '');
                }
            }

            if (elements.studentFinanceEnrollmentMeta) {
                elements.studentFinanceEnrollmentMeta.textContent = availableEnrollments.length
                    ? `Loaded ${availableEnrollments.length} enrollment context${availableEnrollments.length === 1 ? '' : 's'} for this student.`
                    : 'No enrollment linked yet. You can bill first, then assign the student after payment confirmation.';
            }

            {
                if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = formatGroupedMoney(totalInvoiced, currencyTotals, 'totalInvoiced');
                if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = formatGroupedMoney(totalPaid, currencyTotals, 'totalPaid');
                if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = formatGroupedMoney(totalOutstanding, currencyTotals, 'totalOutstanding');
                if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = nextDueDate;
            }

            renderMatches(classroomMatchesJson);
            if (elements.studentClassroomMatchSummary) {
                elements.studentClassroomMatchSummary.removeAttribute('aria-busy');
                restoreStatusAttributes(elements.studentClassroomMatchSummary);
            }
            if (elements.studentFinanceWorkflowNote) {
                elements.studentFinanceWorkflowNote.removeAttribute('aria-busy');
                restoreStatusAttributes(elements.studentFinanceWorkflowNote);
            }
            renderWorkflow(financeWorkflow);
            renderStudentSchedulePrompt();
            renderInvoiceList(invoices);
            if (classroomMatchesJson?.error && elements.studentClassroomMatchSummary) {
                setSectionStatus(elements.studentClassroomMatchSummary, 'Classroom recommendations are temporarily unavailable.', 'btn-retry-student-classroom-matches');
            }
            focusAfterReplacement(elements.studentFinanceWorkflowNote);
        }

        function resolveContext() {
            const enrollments = Array.isArray(modalState.financeEnrollments) ? modalState.financeEnrollments : [];
            const selectedEnrollmentId = String(elements.inputStudentFinanceEnrollment?.value || '').trim();
            if (!enrollments.length) {
                const selectedMatch = getSelectedClassroomMatch();
                return {
                    enrollmentId: null,
                    courseId: selectedMatch?.courseId || null
                };
            }

            if (selectedEnrollmentId) {
                const selected = enrollments.find((row) => String(row.enrollmentId || '') === selectedEnrollmentId);
                if (selected) {
                    return {
                        enrollmentId: selected.enrollmentId || null,
                        courseId: selected.courseId || null
                    };
                }
            }

            if (enrollments.length === 1) {
                return {
                    enrollmentId: enrollments[0].enrollmentId || null,
                    courseId: enrollments[0].courseId || null
                };
            }

            throw new Error('Select the enrollment context first.');
        }

        async function createRecommendedEnrollment() {
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (modalState.financeWorkflow?.requiresPayment) {
                throw new Error('Confirm payment before assigning the student to a classroom.');
            }
            const match = getSelectedClassroomMatch();
            if (!match) throw new Error('Select a classroom recommendation first.');
            if (!window.ClassroomAPI || typeof window.ClassroomAPI.createEnrollment !== 'function') {
                throw new Error('Enrollment helpers are not available.');
            }

            const student = getCurrentStudentProfile();
            const linkedUserId = Array.isArray(student?.linked_user_ids) && student.linked_user_ids.length
                ? String(student.linked_user_ids[0] || '').trim()
                : null;

            const json = await window.ClassroomAPI.createEnrollment({
                studentId: modalState.studentId,
                studentUid: linkedUserId,
                studentName: student?.name || null,
                studentEmail: student?.email || null,
                classId: match.classroomId,
                courseId: match.courseId || null,
                notes: `Recommended classroom match: ${match.name || match.classroomId || 'Classroom'} (${Number(match.fitScore || 0)}% fit).`
            });

            const enrollmentId = String(json.enrollmentId || json.enrollment?.enrollmentId || '').trim();
            if (enrollmentId && elements.inputStudentFinanceEnrollment) {
                elements.inputStudentFinanceEnrollment.value = enrollmentId;
            }

            await refreshStudentFinance();
            await refreshDashboard();
            showToast(`Enrollment created for ${match.name || 'recommended classroom'}.`, 'success');
        }

        async function createInvoiceForStudent() {
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (!window.CrmFinance || typeof window.CrmFinance.buildInvoicePayload !== 'function') {
                throw new Error('Finance helpers are not available.');
            }

            const financeContext = resolveContext();
            const payload = window.CrmFinance.buildInvoicePayload({
                inputInvoiceAmount: elements.inputInvoiceAmount,
                inputInvoiceDiscount: elements.inputInvoiceDiscount,
                inputInvoiceDueDate: elements.inputInvoiceDueDate
            });

            await apiFetchJson('/api/admin/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: modalState.studentId,
                    enrollmentId: financeContext.enrollmentId,
                    courseId: financeContext.courseId,
                    ...payload
                })
            });

            if (elements.inputInvoiceAmount) elements.inputInvoiceAmount.value = '';
            if (elements.inputInvoiceDiscount) elements.inputInvoiceDiscount.value = '';
            if (elements.inputInvoiceDueDate) elements.inputInvoiceDueDate.value = '';
            await refreshStudentFinance();
            await refreshDashboard();
            showToast('Invoice created.', 'success');
        }

        async function recordPaymentForStudent(options = {}) {
            if (options.newIntent === true) resetPaymentIntent();
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (!modalState.selectedInvoiceId) throw new Error('Select an invoice first.');
            if (!window.CrmFinance || typeof window.CrmFinance.buildPaymentPayload !== 'function') {
                throw new Error('Finance helpers are not available.');
            }

            const actorUid = paymentActorUid();
            if (!actorUid) throw new Error('Current staff identity is unavailable. Sign in again before recording payment.');
            const financeContext = resolveContext();
            const payload = window.CrmFinance.buildPaymentPayload({
                inputPaymentAmount: elements.inputPaymentAmount,
                inputPaymentMethod: elements.inputPaymentMethod
            });
            const baseBody = {
                invoiceId: modalState.selectedInvoiceId,
                studentId: modalState.studentId,
                enrollmentId: financeContext.enrollmentId,
                ...payload
            };
            const identity = {
                actorUid,
                studentId: String(modalState.studentId || '').trim(),
                invoiceId: String(modalState.selectedInvoiceId || '').trim(),
                enrollmentId: String(financeContext.enrollmentId || '').trim() || null,
                sessionKey: modalState.studentSessionKey
            };

            if (pendingPaymentIntent) {
                const sameTarget = pendingPaymentIntent.actorUid === identity.actorUid
                    && pendingPaymentIntent.studentId === identity.studentId
                    && pendingPaymentIntent.invoiceId === identity.invoiceId
                    && pendingPaymentIntent.enrollmentId === identity.enrollmentId
                    && pendingPaymentIntent.sessionKey === identity.sessionKey;
                if (!sameTarget) resetPaymentIntent();
                else if (!samePaymentIntent(pendingPaymentIntent.body, baseBody)) {
                    const startNewIntent = typeof window.confirm === 'function'
                        && window.confirm('The previous payment may already have been recorded. Check the payment history before continuing. Record this as a separate payment?');
                    if (!startNewIntent) {
                        throw new Error('Payment details changed after an uncertain save. Start a new payment intent before editing or retrying.');
                    }
                    resetPaymentIntent();
                }
            }

            if (!pendingPaymentIntent) {
                const body = {
                    ...baseBody,
                    operationId: newPaymentOperationId(),
                    paymentDate: payload.paymentDate || new Date().toISOString()
                };
                pendingPaymentIntent = { ...identity, body };
            }
            const submittedIntent = pendingPaymentIntent;

            await apiFetchJson('/api/admin/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(submittedIntent.body)
            });

            const sameTarget = pendingPaymentIntent === submittedIntent
                && submittedIntent.actorUid === paymentActorUid()
                && submittedIntent.studentId === String(modalState.studentId || '').trim()
                && submittedIntent.invoiceId === String(modalState.selectedInvoiceId || '').trim()
                && submittedIntent.sessionKey === modalState.studentSessionKey;
            if (!sameTarget) return;
            let inputsStillMatch = true;
            try {
                const currentContext = resolveContext();
                const currentPayload = window.CrmFinance.buildPaymentPayload({
                    inputPaymentAmount: elements.inputPaymentAmount,
                    inputPaymentMethod: elements.inputPaymentMethod
                });
                inputsStillMatch = samePaymentIntent(submittedIntent.body, {
                    invoiceId: modalState.selectedInvoiceId,
                    studentId: modalState.studentId,
                    enrollmentId: currentContext.enrollmentId,
                    ...currentPayload
                });
            } catch (error) {
                inputsStillMatch = false;
            }
            resetPaymentIntent();
            if (inputsStillMatch && elements.inputPaymentAmount) elements.inputPaymentAmount.value = '';
            await refreshStudentFinance();
            await refreshDashboard();
            showToast('Payment recorded.', 'success');
        }

        return {
            refreshStudentFinance,
            renderStudentFinanceWorkflow: renderWorkflow,
            renderStudentClassroomMatches: renderMatches,
            createRecommendedEnrollment,
            resolveStudentFinanceContext: resolveContext,
            createInvoiceForStudent,
            recordPaymentForStudent,
            resetPaymentIntent
        };
    }

    return {
        createController
    };
})();
