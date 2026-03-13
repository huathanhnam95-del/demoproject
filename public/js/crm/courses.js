window.CrmCourses = (function () {
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
            teachers: Array.isArray(data.teachers) ? data.teachers : []
        };
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
            return `<option value="${course.id}">${label}</option>`;
        }).join('');

        if (selectedValue) {
            selectEl.value = selectedValue;
        }

        return courses;
    }

    return {
        fetchCourses,
        populateCourseSelect
    };
})();
