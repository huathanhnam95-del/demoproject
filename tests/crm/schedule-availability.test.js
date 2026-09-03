const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async function runAvailabilityTests() {
    console.log('Running Schedule Availability component tests...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const scriptPath = path.resolve(__dirname, '../../public/js/crm/schedule-availability.js');
    const cssPath = path.resolve(__dirname, '../../public/crm-admin.css');

    // Load HTML page with CSS and the component script
    await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <link rel="stylesheet" href="file://${cssPath.replace(/\\/g, '/')}">
        </head>
        <body style="padding: 20px; background: #f5f7f9;">
            <div id="availability-container" style="max-width: 680px; background: #fff; padding: 24px; border-radius: 8px;"></div>
        </body>
        </html>
    `);

    await page.addScriptTag({ path: scriptPath });

    // Test 1: Static helper functions
    const helpersTest = await page.evaluate(() => {
        const C = window.CrmScheduleAvailability;
        return {
            keys: C.DAY_KEYS,
            min1: C.timeToMinutes('13:30'),
            time1: C.minutesToTime(810),
            chip1: C.formatDurationChip(120),
            chip2: C.formatDurationChip(90),
            chip3: C.formatDurationChip(45),
            chip4: C.formatDurationChip(0),
            hours1: C.formatHours(270)
        };
    });

    assert.deepStrictEqual(helpersTest.keys, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    assert.strictEqual(helpersTest.min1, 810);
    assert.strictEqual(helpersTest.time1, '13:30');
    assert.strictEqual(helpersTest.chip1, '2h');
    assert.strictEqual(helpersTest.chip2, '1h 30m');
    assert.strictEqual(helpersTest.chip3, '45m');
    assert.strictEqual(helpersTest.chip4, '—');
    assert.strictEqual(helpersTest.hours1, '4.5');
    console.log('✓ Test 1 passed: Static helpers');

    // Test 2: Empty initialization renders 7 days with Unavailable
    const emptyTest = await page.evaluate(() => {
        const container = document.getElementById('availability-container');
        window.availInstance = window.CrmScheduleAvailability.create(container, {
            defaultLessonMinutes: 120,
            timezone: 'Asia/Ho_Chi_Minh'
        });
        const rows = Array.from(container.querySelectorAll('.crm-availability-row'));
        const days = rows.map((r) => r.dataset.day);
        const unavails = Array.from(container.querySelectorAll('.crm-availability-unavailable')).length;
        const state = window.availInstance.getState();
        return {
            rowCount: rows.length,
            days,
            unavailableCount: unavails,
            totalLessons: state.summary.totalLessons,
            totalHours: state.summary.totalHours,
            isValid: state.isValid
        };
    });

    assert.strictEqual(emptyTest.rowCount, 7);
    assert.deepStrictEqual(emptyTest.days, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    assert.strictEqual(emptyTest.unavailableCount, 7);
    assert.strictEqual(emptyTest.totalLessons, 0);
    assert.strictEqual(emptyTest.totalHours, 0);
    assert.strictEqual(emptyTest.isValid, true);
    console.log('✓ Test 2 passed: Empty initialization');

    // Test 3: Initialize with initialSlots
    const slotsTest = await page.evaluate(() => {
        const container = document.getElementById('availability-container');
        window.availInstance.destroy();
        window.availInstance = window.CrmScheduleAvailability.create(container, {
            defaultLessonMinutes: 120,
            timezone: 'Asia/Ho_Chi_Minh',
            initialSlots: [
                { weekday: 1, startTime: '13:30', durationMinutes: 120 }, // Mon 13:30 - 15:30
                { weekday: 3, startTime: '13:30', durationMinutes: 60 }   // Wed 13:30 - 14:30
            ]
        });

        const monRow = container.querySelector('.crm-availability-row[data-day="mon"]');
        const wedRow = container.querySelector('.crm-availability-row[data-day="wed"]');
        const friRow = container.querySelector('.crm-availability-row[data-day="fri"]');

        const monStart = monRow.querySelector('.start-time').value;
        const monEnd = monRow.querySelector('.end-time').value;
        const monChip = monRow.querySelector('.crm-availability-length-chip').textContent;

        const wedStart = wedRow.querySelector('.start-time').value;
        const wedEnd = wedRow.querySelector('.end-time').value;
        const wedChip = wedRow.querySelector('.crm-availability-length-chip').textContent;

        const friUnavailable = Boolean(friRow.querySelector('.crm-availability-unavailable'));

        const slots = window.availInstance.getSlots();
        const state = window.availInstance.getState();

        return {
            monStart, monEnd, monChip,
            wedStart, wedEnd, wedChip,
            friUnavailable,
            slots,
            totalLessons: state.summary.totalLessons,
            totalHours: state.summary.totalHours
        };
    });

    assert.strictEqual(slotsTest.monStart, '13:30');
    assert.strictEqual(slotsTest.monEnd, '15:30');
    assert.strictEqual(slotsTest.monChip, '2h');

    assert.strictEqual(slotsTest.wedStart, '13:30');
    assert.strictEqual(slotsTest.wedEnd, '14:30');
    assert.strictEqual(slotsTest.wedChip, '1h');

    assert.strictEqual(slotsTest.friUnavailable, true);
    assert.strictEqual(slotsTest.totalLessons, 2);
    assert.strictEqual(slotsTest.totalHours, 3);
    assert.strictEqual(slotsTest.slots.length, 2);
    assert.strictEqual(slotsTest.slots[0].weekday, 1);
    assert.strictEqual(slotsTest.slots[0].durationMinutes, 120);
    assert.strictEqual(slotsTest.slots[1].weekday, 3);
    assert.strictEqual(slotsTest.slots[1].durationMinutes, 60);
    console.log('✓ Test 3 passed: Slot seeding & live duration chips');

    // Test 4: Add interval to empty day (Friday)
    await page.click('.crm-availability-row[data-day="fri"] .crm-availability-btn-add');
    const addFridayTest = await page.evaluate(() => {
        const friRow = document.querySelector('.crm-availability-row[data-day="fri"]');
        const start = friRow.querySelector('.start-time').value;
        const end = friRow.querySelector('.end-time').value;
        const chip = friRow.querySelector('.crm-availability-length-chip').textContent;
        const focusedIsStart = document.activeElement === friRow.querySelector('.start-time');
        const state = window.availInstance.getState();
        return { start, end, chip, focusedIsStart, totalLessons: state.summary.totalLessons, totalHours: state.summary.totalHours };
    });

    assert.strictEqual(addFridayTest.start, '09:00');
    assert.strictEqual(addFridayTest.end, '11:00');
    assert.strictEqual(addFridayTest.chip, '2h');
    assert.strictEqual(addFridayTest.focusedIsStart, true);
    assert.strictEqual(addFridayTest.totalLessons, 3);
    assert.strictEqual(addFridayTest.totalHours, 5);
    console.log('✓ Test 4 passed: Add interval to empty day');

    // Test 5: Add second interval on same day (Friday)
    await page.click('.crm-availability-row[data-day="fri"] .crm-availability-btn-add');
    const addSecondFriTest = await page.evaluate(() => {
        const friRow = document.querySelector('.crm-availability-row[data-day="fri"]');
        const items = Array.from(friRow.querySelectorAll('.crm-availability-interval-item'));
        const secondStart = items[1].querySelector('.start-time').value;
        const secondEnd = items[1].querySelector('.end-time').value;
        const secondChip = items[1].querySelector('.crm-availability-length-chip').textContent;
        const focusedIsStart = document.activeElement === items[1].querySelector('.start-time');
        return {
            count: items.length,
            secondStart,
            secondEnd,
            secondChip,
            focusedIsStart
        };
    });

    assert.strictEqual(addSecondFriTest.count, 2);
    // 4 hours after 11:00 is 15:00
    assert.strictEqual(addSecondFriTest.secondStart, '15:00');
    assert.strictEqual(addSecondFriTest.secondEnd, '17:00');
    assert.strictEqual(addSecondFriTest.secondChip, '2h');
    assert.strictEqual(addSecondFriTest.focusedIsStart, true);
    console.log('✓ Test 5 passed: Add multi-interval on same day');

    // Test 6: Remove interval and revert to Unavailable
    // Remove second Friday interval
    await page.click('.crm-availability-row[data-day="fri"] .crm-availability-interval-item:nth-child(2) .crm-availability-btn-remove');
    let friCountAfterOneRemove = await page.evaluate(() => {
        return document.querySelectorAll('.crm-availability-row[data-day="fri"] .crm-availability-interval-item').length;
    });
    assert.strictEqual(friCountAfterOneRemove, 1);

    // Remove first Friday interval (last remaining on Friday)
    await page.click('.crm-availability-row[data-day="fri"] .crm-availability-interval-item:nth-child(1) .crm-availability-btn-remove');
    const friRevertTest = await page.evaluate(() => {
        const friRow = document.querySelector('.crm-availability-row[data-day="fri"]');
        const isUnavailable = Boolean(friRow.querySelector('.crm-availability-unavailable'));
        const addBtnFocused = document.activeElement === friRow.querySelector('.crm-availability-btn-add');
        return { isUnavailable, addBtnFocused };
    });
    assert.strictEqual(friRevertTest.isUnavailable, true);
    assert.strictEqual(friRevertTest.addBtnFocused, true);
    console.log('✓ Test 6 passed: Remove interval & revert to Unavailable');

    // Test 7: Edit start time when endEdited is false (duration expands/shifts to default length)
    await page.evaluate(() => {
        const monStart = document.querySelector('.crm-availability-row[data-day="mon"] .start-time');
        monStart.value = '10:00';
        monStart.dispatchEvent(new Event('change'));
    });
    const editStartTimeTest = await page.evaluate(() => {
        const monRow = document.querySelector('.crm-availability-row[data-day="mon"]');
        return {
            start: monRow.querySelector('.start-time').value,
            end: monRow.querySelector('.end-time').value,
            chip: monRow.querySelector('.crm-availability-length-chip').textContent
        };
    });
    assert.strictEqual(editStartTimeTest.start, '10:00');
    assert.strictEqual(editStartTimeTest.end, '12:00');
    assert.strictEqual(editStartTimeTest.chip, '2h');
    console.log('✓ Test 7 passed: Edit start time auto-reapplies default length');

    // Test 8: Edit end time (marks endEdited=true and sets custom duration)
    await page.evaluate(() => {
        const monEnd = document.querySelector('.crm-availability-row[data-day="mon"] .end-time');
        monEnd.value = '13:30'; // 10:00 to 13:30 is 3h 30m
        monEnd.dispatchEvent(new Event('change'));
    });
    const editEndTimeTest = await page.evaluate(() => {
        const monRow = document.querySelector('.crm-availability-row[data-day="mon"]');
        return {
            start: monRow.querySelector('.start-time').value,
            end: monRow.querySelector('.end-time').value,
            chip: monRow.querySelector('.crm-availability-length-chip').textContent,
            slot: window.availInstance.getSlots().find((s) => s.day === 'mon')
        };
    });
    assert.strictEqual(editEndTimeTest.chip, '3h 30m');
    assert.strictEqual(editEndTimeTest.slot.endEdited, true);
    assert.strictEqual(editEndTimeTest.slot.durationMinutes, 210);

    // Now edit start time on Monday from 10:00 to 11:00 -> should preserve 210m duration!
    await page.evaluate(() => {
        const monStart = document.querySelector('.crm-availability-row[data-day="mon"] .start-time');
        monStart.value = '11:00';
        monStart.dispatchEvent(new Event('change'));
    });
    const preserveDurationTest = await page.evaluate(() => {
        const monRow = document.querySelector('.crm-availability-row[data-day="mon"]');
        return {
            start: monRow.querySelector('.start-time').value,
            end: monRow.querySelector('.end-time').value,
            chip: monRow.querySelector('.crm-availability-length-chip').textContent
        };
    });
    assert.strictEqual(preserveDurationTest.start, '11:00');
    assert.strictEqual(preserveDurationTest.end, '14:30'); // 11:00 + 3h 30m = 14:30
    assert.strictEqual(preserveDurationTest.chip, '3h 30m');
    console.log('✓ Test 8 passed: Custom duration preserved on start time shift');

    // Test 9: setDefaultLessonMinutes updates only non-edited rows
    await page.evaluate(() => {
        window.availInstance.setDefaultLessonMinutes(90); // 1.5h
    });
    const updateDefaultMinutesTest = await page.evaluate(() => {
        const monRow = document.querySelector('.crm-availability-row[data-day="mon"]');
        const wedRow = document.querySelector('.crm-availability-row[data-day="wed"]');
        return {
            monChip: monRow.querySelector('.crm-availability-length-chip').textContent, // was manually edited -> preserved 3h 30m
            wedStart: wedRow.querySelector('.start-time').value,
            wedEnd: wedRow.querySelector('.end-time').value
        };
    });
    assert.strictEqual(updateDefaultMinutesTest.monChip, '3h 30m');
    console.log('✓ Test 9 passed: setDefaultLessonMinutes respects manual edits');

    // Test 10: Validation for end <= start and overlapping windows
    const validationErrorTest = await page.evaluate(() => {
        const monEnd = document.querySelector('.crm-availability-row[data-day="mon"] .end-time');
        monEnd.value = '08:00'; // start is 11:00, end is 08:00 -> error!
        monEnd.dispatchEvent(new Event('change'));

        const validation = window.availInstance.validate();
        const monErrorText = document.querySelector('.crm-availability-day-error[data-day-error="mon"]').textContent;
        return {
            valid: validation.valid,
            errorCount: validation.errors.length,
            monErrorText
        };
    });
    assert.strictEqual(validationErrorTest.valid, false);
    assert(validationErrorTest.monErrorText.includes('End time must be after start time'));

    // Fix error
    await page.evaluate(() => {
        const monEnd = document.querySelector('.crm-availability-row[data-day="mon"] .end-time');
        monEnd.value = '13:00';
        monEnd.dispatchEvent(new Event('change'));
    });
    const fixedTest = await page.evaluate(() => {
        return window.availInstance.validate().valid;
    });
    assert.strictEqual(fixedTest, true);
    console.log('✓ Test 10 passed: Live validation errors and recovery');

    await browser.close();
    console.log('\nAll Schedule Availability tests passed successfully!');
})();
