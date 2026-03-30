window.CrmStudentFinance = (function () {
    function createController(deps = {}) {
        const {
            apiFetchJson,
            elements,
            modalState,
            getCurrentStudentProfile,
            renderStudentSchedulePrompt,
            refreshDashboard,
            showToast,
            escapeHtml,
            getAdminCapabilities
        } = deps;

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

        async function refreshStudentFinance() {
            if (!modalState.studentId) return;

            if (elements.studentInvoiceList && !elements.studentInvoiceList.__crmInvoiceSelectHandlerBound) {
                elements.studentInvoiceList.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('.btn-select-invoice')
                        : null;
                    if (!button || !elements.studentInvoiceList.contains(button)) return;
                    modalState.selectedInvoiceId = String(button.dataset.invoiceId || '').trim();
                    showToast(`Selected ${modalState.selectedInvoiceId} for payment.`, 'success');
                });
                elements.studentInvoiceList.__crmInvoiceSelectHandlerBound = true;
            }

            const financeSummaryPromise = window.CrmFinance
                ? apiFetchJson(`/api/admin/finance/summary?studentId=${encodeURIComponent(modalState.studentId)}`, {
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
                ? window.ClassroomAPI.fetchAttendanceSummary({ studentId: modalState.studentId })
                : Promise.resolve({ students: [] });
            const [json, attendanceJson] = await Promise.all([
                financeSummaryPromise,
                attendanceSummaryPromise
            ]);

            const totalInvoiced = Number(json.totalInvoiced || 0);
            const totalPaid = Number(json.totalPaid || 0);
            const totalOutstanding = Number(json.totalOutstanding || 0);
            const nextDueDate = String(json.nextDueDate || '').trim() || '-';
            const invoices = Array.isArray(json.invoices) ? json.invoices : [];
            const currencyTotals = Array.isArray(json.currencyTotals) ? json.currencyTotals : [];
            const enrollmentRows = Array.isArray(attendanceJson?.students) ? attendanceJson.students : [];
            const activeEnrollments = enrollmentRows.filter((row) => String(row.status || '') === 'active');
            const availableEnrollments = activeEnrollments.length ? activeEnrollments : enrollmentRows;
            const currentEnrollmentId = String(elements.inputStudentFinanceEnrollment?.value || '').trim();
            const currentEnrollment = currentEnrollmentId
                ? availableEnrollments.find((row) => String(row.enrollmentId || '') === currentEnrollmentId)
                : null;
            const classroomMatchCourseId = String(currentEnrollment?.courseId || availableEnrollments[0]?.courseId || '').trim();

            const classroomMatchesPromise = hasCapability('classroomMatches')
                && window.ClassroomAPI
                && typeof window.ClassroomAPI.fetchClassroomMatches === 'function'
                ? window.ClassroomAPI.fetchClassroomMatches(modalState.studentId, classroomMatchCourseId ? { courseId: classroomMatchCourseId } : {}).catch(() => ({
                    matches: [],
                    recommendedClassroom: null,
                    classroomCount: 0,
                    courseId: null,
                    error: true
                }))
                : Promise.resolve({
                    matches: [],
                    recommendedClassroom: null,
                    classroomCount: 0,
                    courseId: null,
                    unsupported: true
                });

            const classroomMatchesJson = await classroomMatchesPromise;
            const financeWorkflow = window.CrmFinance && typeof window.CrmFinance.deriveWorkflowState === 'function'
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

            if (elements.studentFinanceInvoiced) elements.studentFinanceInvoiced.textContent = formatGroupedMoney(totalInvoiced, currencyTotals, 'totalInvoiced');
            if (elements.studentFinancePaid) elements.studentFinancePaid.textContent = formatGroupedMoney(totalPaid, currencyTotals, 'totalPaid');
            if (elements.studentFinanceOutstanding) elements.studentFinanceOutstanding.textContent = formatGroupedMoney(totalOutstanding, currencyTotals, 'totalOutstanding');
            if (elements.studentFinanceNextDue) elements.studentFinanceNextDue.textContent = nextDueDate;

            renderMatches(classroomMatchesJson);
            renderWorkflow(financeWorkflow);
            renderStudentSchedulePrompt();

            if (elements.studentInvoiceList) {
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
            }
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

        async function recordPaymentForStudent() {
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (!modalState.selectedInvoiceId) throw new Error('Select an invoice first.');
            if (!window.CrmFinance || typeof window.CrmFinance.buildPaymentPayload !== 'function') {
                throw new Error('Finance helpers are not available.');
            }

            const financeContext = resolveContext();
            const payload = window.CrmFinance.buildPaymentPayload({
                inputPaymentAmount: elements.inputPaymentAmount,
                inputPaymentMethod: elements.inputPaymentMethod
            });

            await apiFetchJson('/api/admin/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoiceId: modalState.selectedInvoiceId,
                    studentId: modalState.studentId,
                    enrollmentId: financeContext.enrollmentId,
                    ...payload
                })
            });

            if (elements.inputPaymentAmount) elements.inputPaymentAmount.value = '';
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
            recordPaymentForStudent
        };
    }

    return {
        createController
    };
})();
