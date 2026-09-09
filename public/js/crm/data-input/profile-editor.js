window.CrmDataInputProfileEditor = (function () {
    'use strict';
    const fields = {
        learningProfile: [['overall','Overall score','number'],['listening','Listening score','number'],['reading','Reading score','number'],['speaking','Speaking score','number'],['writing','Writing score','number'],['entryLevel','Entry level','text'],['testResultDueDate','Test result deadline','date'],['visaType','Visa type','text'],['targetLevel','Target level','text']],
        targets: [['exam','Target exam','text'],['score','Target score','number']]
    };
    function patch(group, previous, key, raw) {
        const definition = fields[group]?.find(item => item[0] === key);
        if (!definition) throw new Error('Unknown profile field.');
        const text = String(raw ?? '').trim();
        const value = text === '' ? null : definition[2] === 'number' ? Number(text) : text;
        if (definition[2] === 'number' && value !== null && !Number.isFinite(value)) throw new Error('Enter a finite number.');
        return { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), [key]: value };
    }
    function createEditor({ doc, row, group, changed }) {
        const wrapper = doc.createElement('fieldset'); wrapper.style.border = '0'; wrapper.style.padding = '0';
        const legend = doc.createElement('legend'); legend.textContent = group === 'learningProfile' ? 'Learning profile' : 'Learning targets'; wrapper.append(legend);
        for (const [key, title, type] of fields[group]) {
            const label = doc.createElement('label'); label.className = 'crm-input-field';
            const caption = doc.createElement('span'); caption.textContent = title;
            const input = doc.createElement('input'); input.type = type; input.className = 'crm-input'; input.setAttribute('aria-label', title);
            if (type === 'number') input.step = 'any';
            input.value = row.values[group]?.[key] ?? '';
            input.addEventListener('input', () => { row.values[group] = patch(group, row.values[group], key, input.value); changed(); });
            label.append(caption,input); wrapper.append(label);
        }
        return wrapper;
    }
    function contactListFromContext(result, studentId, group) {
        if (!['guardians', 'companies'].includes(group)) throw new Error('Unknown contact group.');
        const record = result?.record;
        if (result?.status !== 'resolved' || record?.kind !== 'student' || record.id !== studentId) throw new Error('Select an accessible existing student first.');
        if ((record.truncatedFields || []).some(field => field === 'contacts' || field === `contacts.${group}` || field.startsWith(`contacts.${group}.`))) throw new Error('The contact list is incomplete. Open the student record to edit this list.');
        const list = record.values.contacts?.[group] || [];
        if (!Array.isArray(list) || list.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error('The contact list is incomplete. Open the student record to edit this list.');
        return JSON.parse(JSON.stringify(list));
    }
    function createContactsEditor({ doc, row, changed, loadCurrent }) {
        const wrapper = doc.createElement('section');
        const make = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
        function render() {
            wrapper.replaceChildren(make('h4', 'Contacts'));
            for (const [group, title, singular] of [['guardians', 'Guardian contacts', 'Guardian'], ['companies', 'Company contacts', 'Company']]) {
                const section = make('fieldset'); section.style.border = '0'; section.style.padding = '0'; section.append(make('legend', title));
                const proposed = Object.hasOwn(row.values.contacts || {}, group);
                section.append(make('p', proposed ? 'This draft replaces this entire list. Check all entries before saving.' : 'This list stays unchanged unless you edit it.'));
                const set = entries => { row.values.contacts = { ...(row.values.contacts || {}), [group]: entries }; changed(); render(); };
                const action = (text, fn) => { const button = make('button', text); button.type = 'button'; button.className = 'crm-btn-secondary'; button.addEventListener('click', fn); section.append(button); return button; };
                const entries = proposed && Array.isArray(row.values.contacts[group]) ? row.values.contacts[group] : [];
                if (proposed && !Array.isArray(row.values.contacts[group])) section.append(make('p', 'The proposed list is invalid. Load the current contacts or start a replacement list.'));
                entries.forEach((entry, index) => {
                    const line = make('div');
                    for (const key of ['name', 'phone', 'email']) {
                        const label = make('label'); label.className = 'crm-input-field';
                        const caption = `${singular} ${index + 1} ${key}`, input = make('input'); input.className = 'crm-input'; input.type = key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'; input.value = entry?.[key] ?? ''; input.setAttribute('aria-label', caption);
                        input.addEventListener('input', () => { entries[index] = { ...(entries[index] || {}), [key]: input.value || null }; changed(); });
                        label.append(make('span', caption), input); line.append(label);
                    }
                    section.append(line);
                    action(`Remove ${singular.toLowerCase()} ${index + 1}`, () => set(entries.filter((_, i) => i !== index)));
                });
                if (proposed || row.kind === 'createStudent') action(`Add ${singular.toLowerCase()}`, () => set([...entries, { name: '', phone: '', email: '' }]));
                if (row.kind === 'updateStudent') {
                    action(`Load current ${title.toLowerCase()}`, async () => {
                        const status = make('p', 'Loading contacts…'); status.setAttribute('role', 'status'); section.append(status);
                        try { const result = await loadCurrent(group); if (wrapper.isConnected) set(result); }
                        catch (error) { if (wrapper.isConnected) status.textContent = error.message; }
                    });
                    if (!proposed) action(`Replace ${title.toLowerCase()} with an empty list`, () => set([]));
                }
                wrapper.append(section);
            }
        }
        render(); return wrapper;
    }
    return Object.freeze({ patch, createEditor, contactListFromContext, createContactsEditor });
})();
