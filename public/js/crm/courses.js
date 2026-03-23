window.CrmCourses = (function () {
    // CRM course catalog is backed by crmCourses, exposed through the admin API.
    async function getAuthHeaders() {
        const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
        if (!auth || !auth.currentUser) return { 'Content-Type': 'application/json' };
        const token = await auth.currentUser.getIdToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    function normalizeCourse(raw) {
        const data = raw.data ? raw.data() : raw;
        return {
            id: raw.id || data.id || data.courseId || null,
            name: data.name || '',
            code: data.code || null,
            label: data.label || null,
            level: data.level || null,
            category: data.category || null,
            status: data.status || 'active',
            description: data.description || null,
            teachers: Array.isArray(data.teachers) ? data.teachers : [],
            deliveryTemplate: data.deliveryTemplate || null
        };
    }

    function buildPayload(elements) {
        const totalHours = Number(elements.inputCourseTotalHours?.value || 0);
        const sessionMinutes = Number(elements.inputCourseDefaultSessionMinutes?.value || 0);
        const durationStepMinutes = Number(elements.inputCourseDurationStep?.value || 30);

        return {
            name: String(elements.inputCourseName?.value || '').trim(),
            code: String(elements.inputCourseCode?.value || '').trim(),
            label: String(elements.inputCourseLabel?.value || '').trim(),
            level: String(elements.inputCourseLevel?.value || '').trim(),
            category: String(elements.inputCourseCategory?.value || '').trim(),
            status: String(elements.inputCourseStatus?.value || '').trim() || 'active',
            description: String(elements.inputCourseDescription?.value || '').trim(),
            teachers: Array.from(elements.courseTeachersList?.querySelectorAll('li[data-email]') || [])
                .map((li) => String(li.dataset.email || '').trim())
                .filter(Boolean),
            deliveryTemplate: {
                totalInstructionMinutes: Number.isFinite(totalHours) && totalHours > 0 ? Math.round(totalHours * 60) : null,
                defaultSessionMinutes: Number.isFinite(sessionMinutes) && sessionMinutes > 0 ? Math.round(sessionMinutes) : null,
                timezone: String(elements.inputCourseTimezone?.value || '').trim() || null,
                durationStepMinutes: Number.isFinite(durationStepMinutes) && durationStepMinutes > 0 ? Math.round(durationStepMinutes) : 30
            }
        };
    }

    function applyToForm(elements, course) {
        if (elements.inputCourseName) elements.inputCourseName.value = String(course?.name || '');
        if (elements.inputCourseCode) elements.inputCourseCode.value = String(course?.code || '');
        if (elements.inputCourseLabel) elements.inputCourseLabel.value = String(course?.label || '');
        if (elements.inputCourseLevel) elements.inputCourseLevel.value = String(course?.level || '');
        if (elements.inputCourseCategory) elements.inputCourseCategory.value = String(course?.category || '');
        if (elements.inputCourseStatus) elements.inputCourseStatus.value = String(course?.status || 'active');
        if (elements.inputCourseDescription) elements.inputCourseDescription.value = String(course?.description || '');
        if (elements.inputCourseTotalHours) {
            const minutes = Number(course?.deliveryTemplate?.totalInstructionMinutes || 0);
            elements.inputCourseTotalHours.value = minutes > 0 ? String((minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)) : '';
        }
        if (elements.inputCourseDefaultSessionMinutes) {
            elements.inputCourseDefaultSessionMinutes.value = String(course?.deliveryTemplate?.defaultSessionMinutes || '');
        }
        if (elements.inputCourseDurationStep) {
            elements.inputCourseDurationStep.value = String(course?.deliveryTemplate?.durationStepMinutes || 30);
        }
        if (elements.inputCourseTimezone) {
            elements.inputCourseTimezone.value = String(course?.deliveryTemplate?.timezone || '');
        }
        if (elements.courseTeachersList) {
            const teachers = Array.isArray(course?.teachers) ? course.teachers : [];
            elements.courseTeachersList.innerHTML = teachers.length
                ? teachers.map((email) => `<li class="crm-tag-item" data-email="${email}"><span>${email}</span></li>`).join('')
                : '<li class="text-muted" data-empty="true">No teachers added yet.</li>';
        }
    }

    async function fetchCourses() {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/admin/courses', { method: 'GET', headers });
        if (!res.ok) throw new Error(`Failed to fetch courses (HTTP ${res.status})`);
        const json = await res.json();
        const courses = (json.courses || []).map(normalizeCourse);
        courses.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        return courses;
    }

    async function populateCourseSelect(selectEl, options = {}) {
        if (!selectEl) return [];
        const courses = await fetchCourses();
        const placeholder = options.placeholder || 'Select a Course...';
        const selectedValue = String(options.selectedValue || selectEl.value || '').trim();

        selectEl.innerHTML = `<option value="">${placeholder}</option>` + courses.map((course) => {
            const label = course.code ? `${course.name} (${course.code})` : course.name;
            const totalMinutes = Number(course?.deliveryTemplate?.totalInstructionMinutes || '');
            const defaultSessionMinutes = Number(course?.deliveryTemplate?.defaultSessionMinutes || '');
            const durationStepMinutes = Number(course?.deliveryTemplate?.durationStepMinutes || '');
            const timezone = String(course?.deliveryTemplate?.timezone || '');
            return `<option value="${course.id}" data-total-minutes="${Number.isFinite(totalMinutes) ? totalMinutes : ''}" data-default-session-minutes="${Number.isFinite(defaultSessionMinutes) ? defaultSessionMinutes : ''}" data-duration-step-minutes="${Number.isFinite(durationStepMinutes) ? durationStepMinutes : ''}" data-timezone="${timezone}">${label}</option>`;
        }).join('');

        if (selectedValue) {
            selectEl.value = selectedValue;
        }

        return courses;
    }

    return {
        fetchCourses,
        populateCourseSelect,
        buildPayload,
        applyToForm
    };
})();
