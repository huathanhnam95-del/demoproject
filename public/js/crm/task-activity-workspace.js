window.CrmTaskActivityWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            dataCache,
            modalState,
            showToast,
            apiFetchJson,
            fetchTasks,
            fetchActivities,
            refreshStudentTimeline,
            refreshLeadWorkspace,
            refreshStudentLists,
            refreshDashboard,
            renderStudentsTable,
            renderLeadStageBoard,
            renderLeadTable,
            resetLeadTaskComposer,
            resetLeadActivityComposer,
            resetStudentTaskComposer,
            resetStudentActivityComposer
        } = deps;

        async function refreshOpenTaskSnapshot() {
            dataCache.openTasks = await fetchTasks({ status: 'open', limit: 300 });

            if (dataCache.students.length) {
                const target = elements.studentsContainer || elements.studentDataContainer || elements.potentialStudentsContainer;
                if (target) {
                    renderStudentsTable(target, dataCache.students, 'No students in database yet.');
                }
                if (elements.potentialStudentsContainer && elements.potentialStudentsContainer !== target) {
                    const buckets = window.CrmStudents.splitStudents(dataCache.students);
                    renderStudentsTable(elements.potentialStudentsContainer, buckets.potential, 'No potential students yet.');
                    renderStudentsTable(elements.studentDataContainer, buckets.studentData, 'No students in database yet.');
                }
            }

            if (dataCache.leads.length) {
                renderLeadStageBoard(dataCache.leads);
                renderLeadTable(dataCache.leads);
            }

            if (modalState.studentId) {
                await refreshStudentTimeline();
            }

            if (modalState.leadId) {
                await refreshLeadWorkspace();
            }
        }

        async function createTaskForLead() {
            if (!modalState.leadId) throw new Error('Select a lead first.');
            if (!window.CrmActivities || typeof window.CrmActivities.buildTaskPayload !== 'function') {
                throw new Error('Activity helpers are not available.');
            }

            const payload = window.CrmActivities.buildTaskPayload({
                inputTaskTitle: elements.inputLeadTaskTitle,
                inputTaskDueAt: elements.inputLeadTaskDueAt,
                inputTaskPriority: elements.inputLeadTaskPriority
            });

            await apiFetchJson('/api/admin/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: modalState.leadId,
                    ...payload
                })
            });

            resetLeadTaskComposer();
            await refreshOpenTaskSnapshot();
            showToast('Lead task added.', 'success');
        }

        async function createActivityForLead() {
            if (!modalState.leadId) throw new Error('Select a lead first.');
            if (!window.CrmActivities || typeof window.CrmActivities.buildActivityPayload !== 'function') {
                throw new Error('Activity helpers are not available.');
            }

            const payload = window.CrmActivities.buildActivityPayload({
                inputActivityType: elements.inputLeadActivityType,
                inputActivitySubject: elements.inputLeadActivitySubject,
                inputActivityBody: elements.inputLeadActivityBody
            });

            await apiFetchJson('/api/admin/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: modalState.leadId,
                    ...payload
                })
            });

            resetLeadActivityComposer();
            await refreshLeadWorkspace();
            showToast('Lead activity logged.', 'success');
        }

        async function createTaskForStudent() {
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (!window.CrmActivities || typeof window.CrmActivities.buildTaskPayload !== 'function') {
                throw new Error('Activity helpers are not available.');
            }

            const payload = window.CrmActivities.buildTaskPayload({
                inputTaskTitle: elements.inputStudentTaskTitle,
                inputTaskDueAt: elements.inputStudentTaskDueAt,
                inputTaskPriority: elements.inputStudentTaskPriority
            });

            await apiFetchJson('/api/admin/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: modalState.studentId,
                    ...payload
                })
            });

            resetStudentTaskComposer();
            await refreshOpenTaskSnapshot();
            showToast('Student task added.', 'success');
        }

        async function createActivityForStudent() {
            if (!modalState.studentId) throw new Error('Save the student profile first.');
            if (!window.CrmActivities || typeof window.CrmActivities.buildActivityPayload !== 'function') {
                throw new Error('Activity helpers are not available.');
            }

            const payload = window.CrmActivities.buildActivityPayload({
                inputActivityType: elements.inputStudentActivityType,
                inputActivitySubject: elements.inputStudentActivitySubject,
                inputActivityBody: elements.inputStudentActivityBody
            });

            await apiFetchJson('/api/admin/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: modalState.studentId,
                    ...payload
                })
            });

            resetStudentActivityComposer();
            await refreshStudentTimeline();
            showToast('Student activity logged.', 'success');
        }

        return {
            refreshOpenTaskSnapshot,
            createTaskForLead,
            createActivityForLead,
            createTaskForStudent,
            createActivityForStudent
        };
    }

    return {
        createController
    };
})();
