(function (globalScope) {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatUsd(cents) {
        const value = Number(cents);
        return Number.isSafeInteger(value) ? `$${(value / 100).toFixed(2)}` : '$0.00';
    }

    function parseUsd(value) {
        const text = String(value ?? '').trim();
        if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return NaN;
        const cents = Math.round(Number(text) * 100);
        return Number.isSafeInteger(cents) && cents >= 0 && cents <= 500 ? cents : NaN;
    }

    function createController(deps = {}) {
        const elements = deps.elements || {};
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : () => {};
        const escape = deps.escapeHtml || escapeHtml;
        const adminMode = deps.adminMode !== false;
        const getCurrentUser = typeof deps.getCurrentUser === 'function'
            ? deps.getCurrentUser
            : () => null;
        const onProjectsRendered = typeof deps.onProjectsRendered === 'function'
            ? deps.onProjectsRendered
            : () => {};
        let bound = false;
        let pending = false;
        let mutationPending = false;
        let refreshBusyCount = 0;
        let fullRefreshPromise = null;
        let fullRefreshGeneration = 0;
        let viewGeneration = 0;
        let peopleRefreshState = null;
        let peopleRefreshGeneration = 0;
        let membersRefreshState = null;
        let membersRefreshGeneration = 0;
        let people = [];
        let eligibleCandidates = [];
        let memberDirectory = [];
        let projects = [];
        let members = [];
        let selectedProjectId = '';
        let selectedProject = null;
        let suppressAutoSelection = false;
        const contentDeniedProjectIds = new Set();
        let calendar = { revision: 0, leaves: [] };
        const calendarControl = (id) => document.getElementById(id);
        let calendarDraftVersion = 0;
        function captureHolidayChoices() {
            const year = calendarControl('projects-calendar-holiday-year')?.value;
            if (!year) return;
            const tetScheme = calendarControl('projects-calendar-tet')?.value;
            const nationalDayAdjacent = calendarControl('projects-calendar-national')?.value;
            calendar.holidayChoices = { ...(calendar.holidayChoices || {}), [year]: { ...(tetScheme ? { tetScheme } : {}), ...(nationalDayAdjacent ? { nationalDayAdjacent } : {}), adoptPublicSectorSwaps: calendarControl('projects-calendar-swaps')?.checked === true } };
            calendarDraftVersion++;
        }
        function renderHolidayChoices() {
            const choices = calendar.holidayChoices?.[calendarControl('projects-calendar-holiday-year')?.value] || {};
            if (calendarControl('projects-calendar-tet')) calendarControl('projects-calendar-tet').value = choices.tetScheme || '';
            if (calendarControl('projects-calendar-national')) calendarControl('projects-calendar-national').value = choices.nationalDayAdjacent || '';
            if (calendarControl('projects-calendar-swaps')) calendarControl('projects-calendar-swaps').checked = choices.adoptPublicSectorSwaps === true;
            const target = calendarControl('projects-calendar-provenance');
            if (target) target.textContent = `Verified Vietnam holiday data is merged with these settings. ${choices.tetScheme && choices.nationalDayAdjacent ? 'Employer holiday choices are configured for this year.' : 'Choose a Tet scheme and National Day adjacent holiday for this year.'} See the project Calendar view for coverage, verification date and source links. Unverified annual dates remain unresolved.`;
        }
        let allowance = { revision: 0, monthlyAllowanceCents: 500 };
        let accessSummary = deps.accessSummary || null;

        function peopleTarget() {
            return adminMode
                ? (elements.staffProjectsPeopleList || elements.projectsPeopleList)
                : elements.projectsPeopleList;
        }

        function applyPendingState() {
            pending = mutationPending || refreshBusyCount > 0;
            [
                elements.projectsRefresh,
                elements.projectsCalendarSave,
                elements.projectsAllowanceSave,
                elements.projectsCalendarLeaveAdd,
                elements.projectsMemberSave,
                elements.projectsProjectSelect,
                elements.projectsCalendarTimezone,
                elements.projectsCalendarLeaveDate,
                elements.projectsCalendarLeaveScope,
                elements.projectsCalendarLeavePerson,
                elements.projectsMemberPerson,
                elements.projectsMemberRole
            ].forEach((control) => { if (control) control.disabled = pending; });
            [elements.projectsMemberPerson, elements.projectsMemberRole, elements.projectsMemberSave].forEach((control) => { if (control) control.disabled = pending || !canManageSelectedProject(); });
            [elements.projectsPeopleList, elements.staffProjectsPeopleList, elements.staffAccountList]
                .filter(Boolean)
                .forEach((target) => target.querySelectorAll(
                    '.crm-projects-account-status, .crm-projects-account-grant, .crm-projects-edit-allowance'
                ).forEach((control) => {
                    if (pending) {
                        control.disabled = true;
                        return;
                    }
                    control.disabled = control.classList.contains('crm-projects-account-status')
                        ? isProtectedAccount(control.dataset.uid, control)
                        : false;
                }));
            elements.projectsMembersList?.querySelectorAll(
                '.crm-projects-member-role, .crm-projects-member-update, .crm-projects-member-remove, .crm-projects-owner-transfer'
            ).forEach((control) => { control.disabled = pending; });
            if (calendarControl('projects-calendar-holiday-choices')) calendarControl('projects-calendar-holiday-choices').disabled = pending;
            if (calendarControl('projects-calendar-leave-end')) calendarControl('projects-calendar-leave-end').disabled = pending;
            elements.projectsCalendarWeekdays?.querySelectorAll('input[name="projects-calendar-weekday"]').forEach((control) => {
                control.disabled = pending;
            });
            elements.projectsCalendarLeaves?.querySelectorAll('.crm-projects-leave-remove').forEach((control) => {
                control.disabled = pending;
            });
        }

        function setPending(value) {
            mutationPending = value === true;
            applyPendingState();
        }

        function beginRefresh() {
            refreshBusyCount += 1;
            applyPendingState();
        }

        function endRefresh() {
            refreshBusyCount = Math.max(0, refreshBusyCount - 1);
            applyPendingState();
        }

        function isProtectedAccount(uid, control = null) {
            const normalizedUid = String(uid || '').trim();
            if (!normalizedUid) return false;
            const currentUid = String(getCurrentUser?.()?.uid || '').trim();
            if (currentUid && currentUid === normalizedUid) return true;
            const row = control?.closest?.('tr');
            if (row?.querySelector('.crm-account-protected')) return true;
            return people.find((person) => String(person?.uid || '').trim() === normalizedUid)?.isProtected === true;
        }

        function getDirectoryPerson(uid) {
            const normalizedUid = String(uid || '').trim();
            return [...memberDirectory, ...eligibleCandidates, ...people]
                .find((person) => String(person?.uid || '').trim() === normalizedUid) || null;
        }

        function buildProjectsAccessCell(person, row = null) {
            if (!person) return '<td class="crm-projects-access-column"><span class="crm-muted">No workforce profile</span></td>';
            const status = String(person.accountStatus || person.workforceStatus || 'active');
            const projectsGrant = person.moduleGrants?.projects === true;
            const uid = escape(person.uid);
            const label = escape(person.displayName || person.email || 'Person');
            const currentUid = String(getCurrentUser?.()?.uid || '').trim();
            const protectedAccount = person.isProtected === true
                || !!row?.querySelector?.('.crm-account-protected')
                || (currentUid && currentUid === String(person.uid || '').trim());
            const statusDisabled = protectedAccount || pending;
            return `<td class="crm-projects-access-column" data-uid="${uid}">
              <div class="crm-projects-account-controls">
                <select class="crm-input crm-projects-account-status" data-uid="${uid}" aria-label="${label} status"${statusDisabled ? ' disabled' : ''}${protectedAccount ? ' title="Protected account status"' : ''}>
                  <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
                  <option value="suspended"${status === 'suspended' ? ' selected' : ''}>Suspended</option>
                  <option value="archived"${status === 'archived' ? ' selected' : ''}>Archived</option>
                </select>
                <label class="crm-projects-grant-toggle"><input type="checkbox" class="crm-projects-account-grant" data-uid="${uid}"${projectsGrant ? ' checked' : ''}${pending ? ' disabled' : ''}> <span>Projects</span></label>
                <span class="crm-projects-allowance-value">${person.allowanceOverrideCents === null ? 'Default' : formatUsd(person.allowanceOverrideCents)}</span>
                <button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-edit-allowance" data-uid="${uid}"${pending ? ' disabled' : ''}>Allowance</button>
              </div>
            </td>`;
        }

        // The Staff workspace owns the account table and its existing actions.
        // Add the Projects controls to those rows so there is one People & Access
        // directory and teacher/admin account actions remain available together.
        function decorateStaffDirectory() {
            const table = elements.staffAccountList?.querySelector('.crm-account-table');
            if (!table) return false;
            const header = table.tHead?.rows?.[0] || table.querySelector('thead tr');
            if (header) {
                header.querySelectorAll('.crm-projects-access-column').forEach((cell) => cell.remove());
                const th = document.createElement('th');
                th.className = 'crm-projects-access-column';
                th.textContent = 'Projects access';
                const actionsHeader = header.querySelector('.crm-account-actions-cell');
                if (actionsHeader) actionsHeader.before(th); else header.appendChild(th);
            }
            table.querySelectorAll('tbody tr').forEach((row) => {
                row.querySelectorAll('.crm-projects-access-column').forEach((cell) => cell.remove());
                const identityControl = row.querySelector('[data-uid]');
                const uid = row.getAttribute('data-account-uid') || identityControl?.getAttribute('data-uid') || '';
                const person = people.find((candidate) => candidate.uid === uid) || null;
                const cell = document.createElement('template');
                cell.innerHTML = buildProjectsAccessCell(person, row).trim();
                const actionsCell = row.querySelector('.crm-account-actions-cell');
                if (actionsCell) actionsCell.before(cell.content.firstElementChild);
                else row.appendChild(cell.content.firstElementChild);
            });
            return true;
        }

        function renderPeople() {
            if (adminMode && decorateStaffDirectory()) return;
            const target = peopleTarget();
            if (!target) return;
            if (!people.length) {
                target.innerHTML = '<p class="crm-muted">No workforce accounts are available.</p>';
                return;
            }
            target.innerHTML = `
                <div class="crm-projects-access-table-wrap">
                  <table class="crm-table crm-projects-access-table">
                    <thead><tr><th>Person</th><th>Workforce</th><th>Projects module</th><th>Monthly allowance</th></tr></thead>
                    <tbody>${people.map((person) => {
                        const status = String(person.accountStatus || person.workforceStatus || 'active');
                        const projectsGrant = person.moduleGrants?.projects === true;
                        return `<tr data-uid="${escape(person.uid)}">
                          <td><strong>${escape(person.displayName || 'Unnamed')}</strong><br><span class="crm-muted">${escape(person.email || 'Workforce account')}</span></td>
                          <td><select class="crm-input crm-projects-account-status" data-uid="${escape(person.uid)}" aria-label="${escape(person.displayName || 'Person')} status">
                            <option value="active"${status === 'active' ? ' selected' : ''}>Active</option>
                            <option value="suspended"${status === 'suspended' ? ' selected' : ''}>Suspended</option>
                            <option value="archived"${status === 'archived' ? ' selected' : ''}>Archived</option>
                          </select></td>
                          <td><label class="crm-projects-grant-toggle"><input type="checkbox" class="crm-projects-account-grant" data-uid="${escape(person.uid)}"${projectsGrant ? ' checked' : ''}${pending ? ' disabled' : ''}> <span>Can use Projects</span></label></td>
                          <td><span class="crm-projects-allowance-value">${person.allowanceOverrideCents === null ? 'Default' : formatUsd(person.allowanceOverrideCents)}</span>
                            <button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-edit-allowance" data-uid="${escape(person.uid)}"${pending ? ' disabled' : ''}>Edit</button></td>
                        </tr>`;
                    }).join('')}</tbody>
                  </table>
                </div>`;
        }

        function eligiblePeople() {
            const source = adminMode ? people : eligibleCandidates;
            return source.filter((person) => person.accountStatus === 'active' && person.moduleGrants?.projects === true);
        }

        function renderPeopleOptions(select, includeEmpty = true) {
            if (!select) return;
            if (select === elements.projectsMemberPerson && !selectedProjectId) { select.innerHTML = '<option value="">Select a project first</option>'; select.value = ''; return; }
            const current = select.value;
            const candidates = eligiblePeople();
            const options = candidates.map((person) => `<option value="${escape(person.uid)}">${escape(person.displayName || person.email || 'Workforce account')}</option>`);
            select.innerHTML = `${includeEmpty ? '<option value="">Choose a person</option>' : ''}${options.join('')}`;
            if (candidates.some((person) => person.uid === current)) select.value = current;
        }

        function renderCalendar(nextCalendar) {
            if (!nextCalendar) return;
            calendar = { ...nextCalendar, leaves: Array.isArray(nextCalendar.leaves) ? nextCalendar.leaves : [] };
            if (elements.projectsCalendarTimezone) elements.projectsCalendarTimezone.value = calendar.timezone || 'Asia/Ho_Chi_Minh';
            elements.projectsCalendarWeekdays?.querySelectorAll('input[name="projects-calendar-weekday"]').forEach((input) => {
                input.checked = calendar.workingWeekdays?.includes(Number(input.value)) === true;
            });
            renderHolidayChoices();
            renderPeopleOptions(elements.projectsCalendarLeavePerson);
            if (elements.projectsCalendarLeaves) {
                elements.projectsCalendarLeaves.innerHTML = calendar.leaves.length
                    ? calendar.leaves.map((leave, index) => {
                        const person = getDirectoryPerson(leave.uid);
                        const label = leave.scope === 'specific_person' ? (person?.displayName || 'Selected person') : 'Whole team';
                        return `<div class="crm-stack-item"><span><strong>${escape(leave.startDate || leave.date)}${leave.endDate && leave.endDate !== (leave.startDate || leave.date) ? ` through ${escape(leave.endDate)}` : ''}</strong> · ${escape(label)}</span><button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-leave-remove" data-index="${index}"${pending ? ' disabled' : ''}>Remove</button></div>`;
                    }).join('')
                    : '<p class="crm-muted">No calendar exceptions.</p>';
            }
        }

        function renderAllowance(nextAllowance) {
            if (!nextAllowance) return;
            allowance = nextAllowance;
            if (elements.projectsAllowanceUsd) elements.projectsAllowanceUsd.value = (Number(nextAllowance.monthlyAllowanceCents ?? 500) / 100).toFixed(2);
        }

        function canManageSelectedProject() {
            if (!selectedProjectId || !selectedProject) return false;
            if (adminMode) return true;
            return selectedProject?.role === 'Owner';
        }

        function canManageProject(projectId) {
            if (adminMode) return true;
            return projects.find((project) => project.id === projectId)?.role === 'Owner';
        }

        function applyAdminVisibility() {
            const adminOnlySections = [elements.projectsCalendarSection, elements.projectsAllowanceSection].filter(Boolean);
            adminOnlySections.forEach((section) => {
                section.hidden = !adminMode;
                section.setAttribute('aria-hidden', adminMode ? 'false' : 'true');
            });
            if (elements.projectsPeopleList) {
                elements.projectsPeopleList.hidden = adminMode;
            }
        }

        function renderProjectPicker() {
            if (!elements.projectsProjectSelect) return;
            const current = selectedProjectId;
            elements.projectsProjectSelect.innerHTML = projects.length
                ? `${suppressAutoSelection ? '<option value="">Select a project</option>' : ''}${projects.map((project) => `<option value="${escape(project.id)}">${escape(project.name || project.title || 'Project')}</option>`).join('')}`
                : '<option value="">No projects available</option>';
            selectedProjectId = projects.some((project) => project.id === current) ? current : (suppressAutoSelection ? '' : (projects[0]?.id || ''));
            elements.projectsProjectSelect.value = selectedProjectId;
            elements.projectsProjectSelect.disabled = pending;
            selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
            if (elements.projectsMemberEditor) elements.projectsMemberEditor.hidden = !canManageSelectedProject();
            renderPeopleOptions(elements.projectsMemberPerson);
            onProjectsRendered({
                projects: projects.slice(),
                selectedProjectId,
                selectedProject: selectedProject ? { ...selectedProject } : null,
                accessSummary,
                contentDeniedProjectIds: [...contentDeniedProjectIds]
            });
        }

        function handleProjectContentDenied(projectId) {
            const deniedId = String(projectId || '').trim();
            if (!adminMode) return invalidateProjectAccess(deniedId);
            if (!deniedId || selectedProjectId !== deniedId) return false;
            // Administrators may manage project membership without content membership.
            // Keep that independent surface, but never retry content on metadata refresh.
            contentDeniedProjectIds.add(deniedId);
            membersRefreshGeneration++; membersRefreshState = null;
            onProjectsRendered({ projects: projects.slice(), selectedProjectId, selectedProject: selectedProject ? { ...selectedProject } : null, accessSummary, contentDeniedProjectIds: [...contentDeniedProjectIds] });
            return refreshMembers({ internal: true });
        }

        function invalidateProjectAccess(projectId) {
            const deniedId = String(projectId || '').trim();
            if (!deniedId || (selectedProjectId !== deniedId && !projects.some((project) => String(project.id) === deniedId))) return false;
            contentDeniedProjectIds.delete(deniedId);
            fullRefreshGeneration++; membersRefreshGeneration++; viewGeneration++;
            fullRefreshPromise = null; membersRefreshState = null;
            projects = projects.filter((project) => String(project.id) !== deniedId);
            accessSummary = accessSummary ? { ...accessSummary, projects: (accessSummary.projects || []).filter((project) => String(project.id) !== deniedId) } : null;
            if (selectedProjectId === deniedId) {
                selectedProjectId = ''; selectedProject = null; members = []; memberDirectory = []; eligibleCandidates = [];
                suppressAutoSelection = true;
                if (elements.projectsMemberPerson) { elements.projectsMemberPerson.innerHTML = '<option value="">Select a project first</option>'; elements.projectsMemberPerson.value = ''; }
                if (elements.projectsMemberRole) elements.projectsMemberRole.value = 'Viewer';
            }
            if (adminMode) { renderProjectPicker(); renderMembers(); }
            else renderMemberProjects({ ...(accessSummary || {}), projects: projects.slice() });
            applyPendingState();
            return true;
        }

        async function selectProject(projectId, { refreshMembers: shouldRefreshMembers = true } = {}) {
            if (pending) return false;
            const nextId = String(projectId || '').trim();
            if (nextId && !projects.some((project) => String(project.id) === nextId)) return false;
            contentDeniedProjectIds.delete(nextId);
            if (nextId === selectedProjectId && shouldRefreshMembers === false) {
                onProjectsRendered({ projects: projects.slice(), selectedProjectId, selectedProject: selectedProject ? { ...selectedProject } : null, accessSummary, contentDeniedProjectIds: [...contentDeniedProjectIds] });
                return true;
            }
            selectedProjectId = nextId;
            viewGeneration += 1;
            selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
            if (elements.projectsProjectSelect) elements.projectsProjectSelect.value = selectedProjectId;
            if (elements.projectsMemberEditor) elements.projectsMemberEditor.hidden = !canManageSelectedProject();
            onProjectsRendered({
                projects: projects.slice(),
                selectedProjectId,
                selectedProject: selectedProject ? { ...selectedProject } : null,
                accessSummary,
                contentDeniedProjectIds: [...contentDeniedProjectIds]
            });
            if (shouldRefreshMembers) await refreshMembers();
            return true;
        }

        function renderMembers() {
            const target = elements.projectsMembersList;
            if (!target) return;
            if (!selectedProjectId) {
                target.innerHTML = '<p class="crm-muted">Select a project to view memberships.</p>';
                return;
            }
            if (!members.length) {
                target.innerHTML = '<p class="crm-muted">No active members are assigned.</p>';
                return;
            }
            const canManage = canManageSelectedProject();
            target.innerHTML = `<div class="crm-projects-members-list">${members.map((member) => {
                const person = getDirectoryPerson(member.uid);
                const label = person?.displayName || person?.email || 'Workforce member';
                const roleOptions = ['Owner', 'Editor', 'Viewer'].map((role) => `<option value="${role}"${member.role === role ? ' selected' : ''}>${role}</option>`).join('');
                return `<div class="crm-stack-item" data-uid="${escape(member.uid)}"><span><strong>${escape(label)}</strong><br><span class="crm-muted">${escape(member.role)}</span></span>${canManage ? `<span class="crm-inline-fields"><select class="crm-input crm-projects-member-role" data-uid="${escape(member.uid)}" aria-label="${escape(label)} role"${pending ? ' disabled' : ''}>${roleOptions}</select><button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-member-update" data-uid="${escape(member.uid)}"${pending ? ' disabled' : ''}>Save</button><button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-member-remove" data-uid="${escape(member.uid)}"${pending ? ' disabled' : ''}>Remove</button>${member.role === 'Owner' ? '' : `<button type="button" class="crm-btn-secondary crm-btn-sm crm-projects-owner-transfer" data-uid="${escape(member.uid)}"${pending ? ' disabled' : ''}>Make owner</button>`}</span>` : ''}</div>`;
            }).join('')}</div>`;
        }

        function renderMemberProjects(summary) {
            accessSummary = summary || null;
            projects = Array.isArray(summary?.projects) ? summary.projects : [];
            applyAdminVisibility();
            renderProjectPicker();
            const target = elements.projectsPeopleList;
            if (target) {
                target.innerHTML = projects.length
                    ? `<div class="crm-projects-member-list">${projects.map((project) => `<div class="crm-stack-item"><strong>${escape(project.name || project.title || 'Project')}</strong><span class="crm-muted">${escape(project.role || 'Viewer')}</span></div>`).join('')}</div>`
                    : '<p class="crm-muted">No Projects memberships are currently assigned.</p>';
            }
            if (elements.projectsMemberAccessSection) elements.projectsMemberAccessSection.hidden = false;
            renderMembers();
        }

        function refreshMembers({ internal = false } = {}) {
            if (mutationPending && !internal) return Promise.resolve(false);
            const projectId = String(selectedProjectId || '').trim();
            if (!projectId || !apiFetchJson) {
                members = [];
                memberDirectory = [];
                eligibleCandidates = [];
                renderMembers();
                return Promise.resolve(false);
            }
            if (membersRefreshState?.projectId === projectId) return membersRefreshState.promise;
            const generation = ++membersRefreshGeneration;
            const actorAtStart = String(getCurrentUser()?.uid || '');
            const canManage = canManageProject(projectId);
            beginRefresh();
            const promise = (async () => {
                if (canManage) {
                    const requests = [apiFetchJson(`/api/projects/${encodeURIComponent(projectId)}/members`),
                        ...(adminMode ? [] : [apiFetchJson(`/api/projects/${encodeURIComponent(projectId)}/eligible-people`)])];
                    const [memberResponse, eligibleResponse] = await Promise.all(requests);
                    if (actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== membersRefreshGeneration || projectId !== String(selectedProjectId || '').trim()) return false;
                    members = Array.isArray(memberResponse?.members) ? memberResponse.members : [];
                    memberDirectory = [];
                    eligibleCandidates = adminMode
                        ? []
                        : (Array.isArray(eligibleResponse?.people) ? eligibleResponse.people.map((person) => ({
                            ...person,
                            accountStatus: 'active',
                            moduleGrants: { projects: true }
                        })) : []);
                } else {
                    const response = await apiFetchJson(`/api/projects/${encodeURIComponent(projectId)}/member-directory`);
                    if (actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== membersRefreshGeneration || projectId !== String(selectedProjectId || '').trim()) return false;
                    memberDirectory = Array.isArray(response?.people) ? response.people : [];
                    members = memberDirectory;
                    eligibleCandidates = [];
                }
                const project = projects.find((candidate) => candidate.id === projectId);
                if (project) selectedProject = project;
                renderPeopleOptions(elements.projectsMemberPerson);
                renderMembers();
                return true;
            })().catch((error) => {
                if (actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== membersRefreshGeneration || projectId !== String(selectedProjectId || '').trim()) return false;
                if ([401, 403, 404].includes(Number(error?.status))) { invalidateProjectAccess(projectId); return false; }
                members = [];
                memberDirectory = [];
                eligibleCandidates = [];
                renderMembers();
                if (error?.status !== 403) showToast(error?.message || 'Project memberships could not be loaded.', 'error');
                return false;
            }).finally(() => {
                if (membersRefreshState?.generation === generation) membersRefreshState = null;
                endRefresh();
            });
            membersRefreshState = { projectId, generation, promise };
            return promise;
        }

        function refreshPeople({ internal = false } = {}) {
            if (mutationPending && !internal) return Promise.resolve(false);
            if (!adminMode || !apiFetchJson) return Promise.resolve(false);
            if (peopleRefreshState) return peopleRefreshState.promise;
            const generation = ++peopleRefreshGeneration;
            beginRefresh();
            const promise = (async () => {
                const response = await apiFetchJson('/api/projects/people');
                if (generation !== peopleRefreshGeneration) return false;
                people = Array.isArray(response?.people) ? response.people : [];
                renderPeople();
                renderPeopleOptions(elements.projectsCalendarLeavePerson);
                renderPeopleOptions(elements.projectsMemberPerson);
                return true;
            })().catch((error) => {
                if (error?.status !== 403 && error?.status !== 404) showToast(error?.message || 'People & Access could not be loaded.', 'error');
                return false;
            }).finally(() => {
                if (peopleRefreshState?.generation === generation) peopleRefreshState = null;
                endRefresh();
            });
            peopleRefreshState = { generation, promise };
            return promise;
        }

        function refresh({ internal = false } = {}) {
            if (mutationPending && !internal) return Promise.resolve(false);
            if (!apiFetchJson) return Promise.resolve(false);
            if (fullRefreshPromise) return fullRefreshPromise;
            const generation = ++fullRefreshGeneration;
            const actorAtStart = String(getCurrentUser()?.uid || '');
            const viewAtStart = viewGeneration;
            beginRefresh();
            const promise = (async () => {
                if (!adminMode) {
                    const response = await apiFetchJson('/api/projects/access');
                    if (actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== fullRefreshGeneration || viewAtStart !== viewGeneration) return false;
                    renderMemberProjects(response);
                    await refreshMembers({ internal: true });
                    return true;
                }
                const [peopleOk, calendarResponse, allowanceResponse, projectResponse] = await Promise.all([
                    refreshPeople({ internal: true }),
                    apiFetchJson('/api/projects/calendar'),
                    apiFetchJson('/api/projects/allowance'),
                    apiFetchJson('/api/projects/')
                ]);
                if (!peopleOk || actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== fullRefreshGeneration || viewAtStart !== viewGeneration) return false;
                projects = Array.isArray(projectResponse?.projects) ? projectResponse.projects : [];
                applyAdminVisibility();
                renderPeople();
                renderCalendar(calendarResponse?.calendar);
                renderAllowance(allowanceResponse?.allowance);
                renderProjectPicker();
                await refreshMembers({ internal: true });
                return true;
            })().catch((error) => {
                if (actorAtStart !== String(getCurrentUser()?.uid || '') || generation !== fullRefreshGeneration || viewAtStart !== viewGeneration) return false;
                showToast(error?.message || 'Projects access could not be loaded.', 'error');
                return false;
            }).finally(() => {
                if (fullRefreshPromise === promise) fullRefreshPromise = null;
                endRefresh();
            });
            fullRefreshPromise = promise;
            return promise;
        }

        async function updatePerson(uid, patch) {
            if (pending) return;
            const person = people.find((candidate) => candidate.uid === uid);
            const payload = { ...patch, expectedRevision: person?.workforceRevision };
            setPending(true);
            try {
                await apiFetchJson(`/api/projects/people/${encodeURIComponent(uid)}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                showToast('People & Access updated.', 'success');
            } catch (error) {
                showToast(error?.message || 'People & Access update failed.', 'error');
            } finally {
                await refresh({ internal: true });
                setPending(false);
            }
        }

        async function saveCalendar() {
            if (pending) return;
            const saveUid = String(getCurrentUser()?.uid || ''), saveGeneration = viewGeneration;
            captureHolidayChoices();
            const saveVersion = calendarDraftVersion;
            let calendarSaved = false;
            const workingWeekdays = Array.from(elements.projectsCalendarWeekdays?.querySelectorAll('input[name="projects-calendar-weekday"]') || [])
                .filter((input) => input.checked).map((input) => Number(input.value));
            setPending(true);
            try {
                await apiFetchJson('/api/projects/calendar', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timezone: elements.projectsCalendarTimezone?.value, workingWeekdays, leaves: calendar.leaves, holidayChoices: calendar.holidayChoices || {}, expectedRevision: calendar.revision })
                });
                if (saveUid !== String(getCurrentUser()?.uid || '') || saveGeneration !== viewGeneration) return;
                calendarSaved = true;
                showToast('Project calendar settings saved.', 'success');
            } catch (error) { if (saveUid === String(getCurrentUser()?.uid || '') && saveGeneration === viewGeneration) showToast(error?.message || 'Calendar settings could not be saved.', 'error'); }
            finally { if (saveUid === String(getCurrentUser()?.uid || '') && saveGeneration === viewGeneration) { if (calendarSaved && saveVersion === calendarDraftVersion) await refresh({ internal: true }); setPending(false); } }
        }

        async function saveAllowance() {
            if (pending) return;
            const cents = parseUsd(elements.projectsAllowanceUsd?.value);
            if (Number.isNaN(cents)) {
                showToast('Enter a USD amount from 0 to 5 with up to two decimal places.', 'error');
                return;
            }
            setPending(true);
            try {
                await apiFetchJson('/api/projects/allowance', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyAllowanceCents: cents, expectedRevision: allowance.revision })
                });
                showToast('Starting allowance saved.', 'success');
            } catch (error) { showToast(error?.message || 'Allowance could not be saved.', 'error'); }
            finally { await refresh({ internal: true }); setPending(false); }
        }

        async function savePersonAllowance(uid) {
            if (pending) return;
            const person = people.find((candidate) => candidate.uid === uid);
            const value = window.prompt('Monthly allowance in USD (0 to 5):', person?.allowanceOverrideCents === null ? '5.00' : (Number(person?.allowanceOverrideCents || 0) / 100).toFixed(2));
            if (value === null) return;
            const cents = parseUsd(value);
            if (Number.isNaN(cents)) { showToast('Enter a USD amount from 0 to 5 with up to two decimal places.', 'error'); return; }
            setPending(true);
            try {
                const current = await apiFetchJson(`/api/projects/allowance/${encodeURIComponent(uid)}`);
                await apiFetchJson(`/api/projects/allowance/${encodeURIComponent(uid)}`, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyAllowanceCents: cents, expectedRevision: current?.allowance?.revision })
                });
                showToast('Account allowance saved.', 'success');
            } catch (error) { showToast(error?.message || 'Account allowance could not be saved.', 'error'); }
            finally { await refresh({ internal: true }); setPending(false); }
        }

        async function saveMember(uid, role) {
            if (pending) return;
            if (!selectedProjectId || !role) return;
            setPending(true);
            try {
                const existing = members.find((member) => member.uid === uid);
                const method = existing ? 'PATCH' : 'POST';
                const url = existing
                    ? `/api/projects/${encodeURIComponent(selectedProjectId)}/members/${encodeURIComponent(uid)}`
                    : `/api/projects/${encodeURIComponent(selectedProjectId)}/members`;
                await apiFetchJson(url, {
                    method, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid, role, expectedRevision: selectedProject?.membershipRevision })
                });
                showToast('Project membership saved.', 'success');
            } catch (error) { showToast(error?.message || 'Project membership could not be saved.', 'error'); }
            finally { await refresh({ internal: true }); setPending(false); }
        }

        async function removeMember(uid) {
            if (pending) return;
            if (!selectedProjectId) return;
            setPending(true);
            try {
                await apiFetchJson(`/api/projects/${encodeURIComponent(selectedProjectId)}/members/${encodeURIComponent(uid)}`, {
                    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: selectedProject?.membershipRevision })
                });
                showToast('Project membership removed.', 'success');
            } catch (error) { showToast(error?.message || 'Project membership could not be removed.', 'error'); }
            finally { await refresh({ internal: true }); setPending(false); }
        }

        async function transferOwner(uid) {
            if (pending) return;
            if (!selectedProjectId) return;
            setPending(true);
            try {
                await apiFetchJson(`/api/projects/${encodeURIComponent(selectedProjectId)}/owner-transfer`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetUid: uid, expectedRevision: selectedProject?.membershipRevision })
                });
                showToast('Project owner updated.', 'success');
            } catch (error) { showToast(error?.message || 'Project owner could not be updated.', 'error'); }
            finally { await refresh({ internal: true }); setPending(false); }
        }

        function init() {
            if (bound) return;
            bound = true;
            [elements.projectsPeopleList, elements.staffProjectsPeopleList, elements.staffAccountList].filter(Boolean).forEach((target) => {
                target.addEventListener('change', (event) => {
                    const grant = event.target.closest('.crm-projects-account-grant');
                    if (grant) updatePerson(grant.dataset.uid, { projects: grant.checked });
                    const status = event.target.closest('.crm-projects-account-status');
                    if (status) updatePerson(status.dataset.uid, { status: status.value });
                });
                target.addEventListener('click', (event) => {
                    const button = event.target.closest('.crm-projects-edit-allowance');
                    if (button) savePersonAllowance(button.dataset.uid);
                });
            });
            elements.projectsCalendarLeaveAdd?.addEventListener('click', () => {
                if (pending) return;
                const date = String(elements.projectsCalendarLeaveDate?.value || '').trim();
                const endDate = calendarControl('projects-calendar-leave-end')?.value || date;
                const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
                if (!validDate(date) || !validDate(endDate) || endDate < date || Date.parse(endDate) - Date.parse(date) > 365 * 86400000) { showToast('Choose a real inclusive leave range of at most 366 days.', 'error'); return; }
                captureHolidayChoices();
                const scope = String(elements.projectsCalendarLeaveScope?.value || 'whole_team');
                const uid = String(elements.projectsCalendarLeavePerson?.value || '').trim();
                if (!date || (scope === 'specific_person' && !uid)) { showToast('Choose a date and eligible person for this exception.', 'error'); return; }
                calendar.leaves = [...calendar.leaves, { ...(endDate === date ? { date } : { startDate: date, endDate }), scope, uid: scope === 'specific_person' ? uid : null }];
                if (elements.projectsCalendarLeaveDate) elements.projectsCalendarLeaveDate.value = '';
                if (calendarControl('projects-calendar-leave-end')) calendarControl('projects-calendar-leave-end').value = '';
                calendarDraftVersion++;
                renderCalendar(calendar);
            });
            elements.projectsCalendarLeaves?.addEventListener('click', (event) => {
                if (pending) return;
                const remove = event.target.closest('.crm-projects-leave-remove');
                if (!remove) return;
                captureHolidayChoices();
                calendarDraftVersion++;
                calendar.leaves = calendar.leaves.filter((_leave, index) => index !== Number(remove.dataset.index));
                renderCalendar(calendar);
            });
            calendarControl('projects-calendar-holiday-year')?.addEventListener('change', renderHolidayChoices);
            ['projects-calendar-tet', 'projects-calendar-national', 'projects-calendar-swaps'].forEach((id) => calendarControl(id)?.addEventListener('change', captureHolidayChoices));
            elements.projectsCalendarSave?.addEventListener('click', () => saveCalendar());
            elements.projectsAllowanceSave?.addEventListener('click', () => saveAllowance());
            elements.projectsRefresh?.addEventListener('click', () => refresh());
            elements.projectsProjectSelect?.addEventListener('change', async (event) => {
                await selectProject(event.target.value);
            });
            elements.projectsMemberSave?.addEventListener('click', () => saveMember(elements.projectsMemberPerson?.value, elements.projectsMemberRole?.value));
            elements.projectsMembersList?.addEventListener('click', (event) => {
                const update = event.target.closest('.crm-projects-member-update');
                if (update) {
                    const role = event.target.closest('.crm-stack-item')?.querySelector('.crm-projects-member-role')?.value;
                    saveMember(update.dataset.uid, role);
                    return;
                }
                const remove = event.target.closest('.crm-projects-member-remove');
                if (remove) { removeMember(remove.dataset.uid); return; }
                const transfer = event.target.closest('.crm-projects-owner-transfer');
                if (transfer) transferOwner(transfer.dataset.uid);
            });
        }

        return {
            init,
            refresh,
            refreshPeople,
            renderPeople,
            selectProject,
            invalidateProjectAccess,
            handleProjectContentDenied,
            getSelection: () => ({
                projects: projects.slice(),
                selectedProjectId,
                selectedProject: selectedProject ? { ...selectedProject } : null,
                accessSummary,
                contentDeniedProjectIds: [...contentDeniedProjectIds]
            })
        };
    }

    globalScope.CrmProjectsAccess = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
