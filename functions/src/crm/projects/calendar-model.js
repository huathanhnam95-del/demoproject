'use strict';

const { DomainError, normalizeDate } = require('./domain/validation');
const FEED_VERSION = 'vn-verified-2026-09-07-v1';
const VERIFIED_AT = '2026-09-07';
const SOURCES = Object.freeze({
    law: 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2019/12/45.signed.pdf',
    tet: 'https://baochinhphu.vn/bo-noi-vu-thong-bao-lich-nghi-tet-am-lich-va-nghi-le-quoc-khanh-nam-2026-102251017095507785.htm',
    lunar: 'https://xaydungchinhsach.chinhphu.vn/lich-nghi-le-gio-to-hung-vuong-30-4-1-5-quoc-khanh-2-9-nam-2026-119260222115822151.htm',
    national: 'https://xaydungchinhsach.chinhphu.vn/thong-bao-lich-nghi-le-quoc-khanh-2026-119260729092042494.htm',
    newYear: 'https://media.chinhphu.vn/cong-chuc-vien-chuc-duoc-nghi-4-ngay-dip-tet-duong-lich-2026-102251225111845247.htm',
    culture: 'https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-28-2026-qh16-ve-phat-trien-van-hoa-viet-nam-119260508142130402.htm'
});
function dateValue(value, label = 'date') {
    const date = normalizeDate(value, label);
    if (!date) throw new DomainError(400, 'INVALID_DATE', `${label} is required.`);
    return date;
}
function addDays(date, amount) { return new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10); }
function datesInRange(from, to, maximum = 366) {
    from = dateValue(from, 'fromDate'); to = dateValue(to, 'toDate');
    const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (count < 1 || count > maximum) throw new DomainError(400, 'INVALID_DATE_RANGE', `Date range must contain 1 to ${maximum} days.`);
    return Array.from({ length: count }, (_, i) => addDays(from, i));
}
function normalizeHolidayChoices(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 20) throw new DomainError(400, 'INVALID_HOLIDAY_CHOICES', 'Holiday choices must be a bounded year map.');
    const result = {};
    for (const [year, choice] of Object.entries(value)) {
        if (!/^20\d{2}$/.test(year) || !choice || typeof choice !== 'object' || Array.isArray(choice)
            || Object.keys(choice).some((key) => !['tetScheme', 'nationalDayAdjacent', 'adoptPublicSectorSwaps'].includes(key))) throw new DomainError(400, 'INVALID_HOLIDAY_CHOICES', 'Invalid holiday choice.');
        if (choice.tetScheme !== undefined && !['before1_after3', 'before2_after2', 'before3_after1'].includes(choice.tetScheme)) throw new DomainError(400, 'INVALID_HOLIDAY_CHOICES', 'Invalid Tet scheme.');
        if (choice.nationalDayAdjacent !== undefined && !['before', 'after'].includes(choice.nationalDayAdjacent)) throw new DomainError(400, 'INVALID_HOLIDAY_CHOICES', 'Invalid National Day selection.');
        if (choice.adoptPublicSectorSwaps !== undefined && typeof choice.adoptPublicSectorSwaps !== 'boolean') throw new DomainError(400, 'INVALID_HOLIDAY_CHOICES', 'Swap adoption must be a boolean.');
        result[year] = { ...choice };
    }
    return result;
}
function holidayYear(year, config = {}) {
    const weekdays = config.workingWeekdays || [1, 2, 3, 4, 5];
    const choices = config.holidayChoices?.[year] || {};
    const holidays = new Map(); const workingSwaps = new Set(); const unresolved = [];
    if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new DomainError(400, 'INVALID_WORKING_WEEK', 'A nonempty valid working week is required.');
    const add = (date, code, source, extra = {}) => {
        const reasons = holidays.get(date) || [];
        reasons.push({ code, source, scope: 'organization', status: 'verified', feedVersion: FEED_VERSION, ...extra });
        holidays.set(date, reasons);
    };
    for (const [suffix, code] of [['01-01', 'new_year'], ['04-30', 'reunification'], ['05-01', 'labour_day'], ['09-02', 'national_day']]) add(`${year}-${suffix}`, code, SOURCES.law);
    if (year >= 2026) add(`${year}-11-24`, 'culture_day', SOURCES.culture);
    if (choices.nationalDayAdjacent) add(`${year}-09-${choices.nationalDayAdjacent === 'before' ? '01' : '03'}`, 'national_day_adjacent', year === 2026 ? SOURCES.national : SOURCES.law, { selection: choices.nationalDayAdjacent, basis: 'explicit_employer_selection' });
    else unresolved.push(`${year}:nationalDayAdjacent`);
    if (year === 2026) {
        add('2026-04-26', 'hung_kings', SOURCES.lunar);
        if (choices.tetScheme) {
            const first = { before1_after3: '2026-02-16', before2_after2: '2026-02-15', before3_after1: '2026-02-14' }[choices.tetScheme];
            for (let i = 0; i < 5; i++) add(addDays(first, i), 'tet', SOURCES.tet, { selection: choices.tetScheme });
        } else unresolved.push('2026:tetScheme');
        if (choices.adoptPublicSectorSwaps === true) {
            add('2026-01-02', 'adopted_public_sector_swap', SOURCES.newYear);
            add('2026-08-31', 'adopted_public_sector_swap', SOURCES.national);
            workingSwaps.add('2026-01-10'); workingSwaps.add('2026-08-22');
        }
    } else unresolved.push(`${year}:verifiedLunarDates`, `${year}:verifiedAnnualSwaps`);
    // Compensation only follows a statutory holiday/weekly-rest collision.
    // Manual leave is merged later and cannot manufacture compensation.
    for (const [date, reasons] of [...holidays].sort()) {
        if (reasons.every((r) => r.code === 'adopted_public_sector_swap')) continue;
        if (weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || workingSwaps.has(date)) continue;
        if (reasons.some((r) => r.code === 'culture_day')) { unresolved.push(`${year}:cultureDayCompensation`); continue; }
        let replacement = addDays(date, 1);
        for (let i = 0; i < 366; i++, replacement = addDays(replacement, 1)) {
            if (!holidays.has(replacement) && (weekdays.includes(new Date(`${replacement}T00:00:00Z`).getUTCDay()) || workingSwaps.has(replacement))) {
                add(replacement, 'weekly_rest_compensation', SOURCES.law, { compensatesDate: date }); break;
            }
        }
    }
    return { holidays, workingSwaps, unresolved };
}
function calendarSummary(config = {}, years = [2026]) {
    const requiresConfiguration = [...new Set(years.flatMap((year) => holidayYear(year, config).unresolved))];
    return { timezone: config.timezone || 'Asia/Ho_Chi_Minh', revision: Number(config.revision || 0), feedVersion: FEED_VERSION,
        coverage: { verifiedAt: VERIFIED_AT, annualYears: [2026], fixedDatesFromLaw: true, sourceUrls: Object.values(SOURCES), status: requiresConfiguration.length ? 'incomplete' : 'verified', scope: 'Vietnam organization calendar; person-specific foreign entitlements require configuration' }, requiresConfiguration };
}
function calendarDays(config, from, to, memberUids = []) {
    const dates = datesInRange(from, to); const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))];
    const feeds = new Map(years.map((year) => [year, holidayYear(year, config)]));
    const allowed = [...new Set(memberUids)];
    const days = dates.map((date) => {
        const feed = feeds.get(Number(date.slice(0, 4))); const reasons = [...(feed.holidays.get(date) || [])];
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (!(config.workingWeekdays || [1, 2, 3, 4, 5]).includes(weekday) && !feed.workingSwaps.has(date)) reasons.push({ code: 'weekly_rest', scope: 'organization', source: 'organization_configuration' });
        const leaves = (config.leaves || []).filter((leave) => (leave.startDate || leave.date) <= date && (leave.endDate || leave.date || leave.startDate) >= date);
        if (leaves.some((leave) => leave.scope === 'whole_team')) reasons.push({ code: 'whole_team_leave', scope: 'organization', source: 'manual_configuration' });
        const members = allowed.map((uid) => {
            const ownReasons = [...reasons];
            if (leaves.some((leave) => leave.scope === 'specific_person' && leave.uid === uid)) ownReasons.push({ code: 'personal_leave', scope: 'person', source: 'manual_configuration' });
            return { uid, working: ownReasons.length === 0, reasons: ownReasons };
        });
        return { date, organization: { working: reasons.length === 0, reasons }, members, workingSwap: feed.workingSwaps.has(date), workingSwapProvenance: feed.workingSwaps.has(date) ? { source: date === '2026-01-10' ? SOURCES.newYear : SOURCES.national, status: 'verified', scope: 'explicitly_adopted_public_sector', feedVersion: FEED_VERSION } : null };
    });
    return { ...calendarSummary(config, years), days };
}
function evaluateSchedule(task, config, startDate, dueDate) {
    const calendar = calendarDays(config, startDate, dueDate, [task.ownerUid, ...(task.assigneeUids || [])].filter(Boolean));
    const nonWorkingDays = []; const warnings = [];
    for (const day of calendar.days) {
        const availability = task.ownerUid ? day.members.find((m) => m.uid === task.ownerUid) : day.organization;
        if (!availability.working) nonWorkingDays.push({ date: day.date, reasons: availability.reasons });
        for (const member of day.members) if (member.uid !== task.ownerUid && (task.assigneeUids || []).includes(member.uid) && member.reasons.some((r) => r.code === 'personal_leave')) warnings.push({ code: 'ASSIGNEE_LEAVE', date: day.date, uid: member.uid });
    }
    if (calendar.requiresConfiguration.length) warnings.push({ code: 'CALENDAR_INCOMPLETE', choices: calendar.requiresConfiguration });
    return { workingDayCount: calendar.requiresConfiguration.length ? null : calendar.days.length - nonWorkingDays.length, nonWorkingDays, warnings, calendar };
}
module.exports = { FEED_VERSION, VERIFIED_AT, SOURCES, dateValue, addDays, datesInRange, normalizeHolidayChoices, holidayYear, calendarSummary, calendarDays, evaluateSchedule };
