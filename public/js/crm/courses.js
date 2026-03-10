window.CrmCourses = (function () {
    function getDb() {
        return typeof firebase !== 'undefined' ? firebase.firestore() : null;
    }

    function normalizeCourse(doc) {
        const data = doc.data ? doc.data() : doc;
        return {
            id: doc.id || data.id || null,
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
        const db = getDb();
        if (!db) throw new Error('Firebase DB not initialized');

        const snapshot = await db.collection('crmCourses').get();
        const courses = snapshot.docs.map(normalizeCourse);
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
