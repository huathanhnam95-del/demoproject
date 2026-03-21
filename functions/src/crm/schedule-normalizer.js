function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function cleanOptionalArray(value) {
    if (value === null || value === undefined || value === '') return [];
    const list = Array.isArray(value) ? value : String(value).split(',');
    const seen = new Set();
    const output = [];

    for (const entry of list) {
        const normalized = cleanOptionalString(entry);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }

    return output;
}

const DAY_ALIASES = new Map([
    ['mon', 'Monday'],
    ['monday', 'Monday'],
    ['tue', 'Tuesday'],
    ['tues', 'Tuesday'],
    ['tuesday', 'Tuesday'],
    ['wed', 'Wednesday'],
    ['weds', 'Wednesday'],
    ['wednesday', 'Wednesday'],
    ['thu', 'Thursday'],
    ['thur', 'Thursday'],
    ['thurs', 'Thursday'],
    ['thursday', 'Thursday'],
    ['fri', 'Friday'],
    ['friday', 'Friday'],
    ['sat', 'Saturday'],
    ['saturday', 'Saturday'],
    ['sun', 'Sunday'],
    ['sunday', 'Sunday']
]);

const KEYWORD_DAY_GROUPS = [
    { pattern: /\bweekdays?\b/i, days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
    { pattern: /\bweekends?\b/i, days: ['Saturday', 'Sunday'] },
    { pattern: /\bweeknights?\b/i, days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] }
];

const KEYWORD_HOURS = [
    { pattern: /\bweeknights?\b/i, hours: ['19:00-21:00'] },
    { pattern: /\bmorning\b/i, hours: ['08:00-10:00'] },
    { pattern: /\bafternoon\b/i, hours: ['13:00-15:00'] },
    { pattern: /\bevening\b/i, hours: ['19:00-21:00'] },
    { pattern: /\bnight\b/i, hours: ['19:00-21:00'] }
];

function dedupePreserveOrder(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
        const normalized = cleanOptionalString(value);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function extractTimeRanges(text) {
    const source = String(text || '');
    const ranges = [];
    const regex = /\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g;
    let match = regex.exec(source);
    while (match) {
        ranges.push(match[0].replace(/\s+/g, ''));
        match = regex.exec(source);
    }
    return dedupePreserveOrder(ranges);
}

function extractDayNames(text) {
    const source = String(text || '');
    const days = [];
    const tokenRegex = /\b(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/gi;
    let match = tokenRegex.exec(source);
    while (match) {
        const mapped = DAY_ALIASES.get(match[1].toLowerCase());
        if (mapped) days.push(mapped);
        match = tokenRegex.exec(source);
    }
    return dedupePreserveOrder(days);
}

function parseScheduleText(text) {
    const source = String(text || '').trim();
    if (!source) {
        return { days: [], hours: [] };
    }

    const explicitDaysMatch = source.match(/\b(?:days?|day)\s*:\s*([^|]+)(?:\||$)/i);
    const explicitHoursMatch = source.match(/\b(?:hours?|hour)\s*:\s*([^|]+)(?:\||$)/i);

    let days = explicitDaysMatch ? extractDayNames(explicitDaysMatch[1]) : extractDayNames(source);
    let hours = explicitHoursMatch ? extractTimeRanges(explicitHoursMatch[1]) : extractTimeRanges(source);

    if (!days.length) {
        for (const group of KEYWORD_DAY_GROUPS) {
            if (group.pattern.test(source)) {
                days = group.days.slice();
                break;
            }
        }
    }

    if (!hours.length) {
        for (const group of KEYWORD_HOURS) {
            if (group.pattern.test(source)) {
                hours = group.hours.slice();
                break;
            }
        }
    }

    return {
        days: dedupePreserveOrder(days),
        hours: dedupePreserveOrder(hours)
    };
}

function hydrateStudentSchedule(student = {}) {
    const preferredLearningDays = cleanOptionalArray(student.preferredLearningDays);
    const preferredLearningHours = cleanOptionalArray(student.preferredLearningHours);
    const preferredSchedule = cleanOptionalString(student.preferredSchedule);
    const text = [
        preferredSchedule,
        student.notes,
        student.counselingNotes
    ].map(cleanOptionalString).filter(Boolean).join(' | ');
    const parsed = parseScheduleText(text);

    return {
        preferredSchedule: preferredSchedule || null,
        preferredLearningDays: preferredLearningDays.length ? preferredLearningDays : parsed.days,
        preferredLearningHours: preferredLearningHours.length ? preferredLearningHours : parsed.hours
    };
}

function hydrateClassroomSchedule(classroom = {}) {
    const meetingDays = cleanOptionalArray(classroom.meetingDays);
    const meetingHours = cleanOptionalArray(classroom.meetingHours);
    const text = [
        classroom.meetingSchedule,
        classroom.schedule,
        classroom.name,
        classroom.label
    ].map(cleanOptionalString).filter(Boolean).join(' | ');
    const parsed = parseScheduleText(text);

    return {
        meetingDays: meetingDays.length ? meetingDays : parsed.days,
        meetingHours: meetingHours.length ? meetingHours : parsed.hours
    };
}

module.exports = {
    hydrateStudentSchedule,
    hydrateClassroomSchedule,
    parseScheduleText,
    extractDayNames,
    extractTimeRanges,
    cleanOptionalArray
};
