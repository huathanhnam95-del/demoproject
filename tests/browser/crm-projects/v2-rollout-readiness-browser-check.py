"""Offline Chrome rollback ownership and preference checks using the production shell.

No login, customer data, remote requests or production flag changes. The shell
harness also supplies separate fresh flag-off/on boots with retained legacy prefs.
Actual browser zoom and full board remount are covered by PR10 and fresh boots.
"""
import runpy
from pathlib import Path


def check(page, enabled, stored, out, size):
    before = page.evaluate('({calls:calls.length, key:storage.getItem("crm:projects:ui-scale"), pane:originalPane.parentElement.id})')
    if enabled:
        page.locator('#projects-utab-assistant').click()
        page.locator('#probe-direct').click()
        assert page.evaluate('directClicks') == 1
        page.evaluate('presentation.preferences.setDensity("compact"); presentation.dispose(); presentation.dispose()')
        assert page.locator('[data-projects-ui="v2"]').count() == 0
        assert page.locator('#projects-utility-page').count() == 0
        assert page.locator('#projects-v2-table').count() == 0
        assert page.locator('#projects-board-table').get_attribute('data-presentation') is None
        assert page.locator('#projects-board-table').get_attribute('role') == 'table'
        assert page.locator('dialog[open]').count() == 0
        assert page.evaluate('document.getElementById("projects-upane-assistant")===originalPane')
        assert page.evaluate('storage.getItem("crm:projects:ui-scale")') == stored
        page.evaluate('''() => {
            const panel=document.querySelector('[data-panel="projects"]');
            window.rollback=CrmProjectsPresentationV2.createController({config:{projectsV2:false},panel,
                createWorkspace:()=>CrmProjectsWorkspace.createController({getCurrentUser:()=>({uid:actor})})});
            rollback.init();rollback.init();window.rollbackScale=CrmProjectsUiScale.init({panel,storage});
        }''')
    else:
        assert page.locator('#projects-utility-page').count() == 0
    expected = float(stored or '125') / 100
    assert float(page.locator('[data-panel="projects"]').evaluate('e=>getComputedStyle(e).zoom')) == expected
    assert page.locator('label[for="projects-ui-scale"]').text_content() == 'Interface size'
    assert page.locator('#projects-utility-rail').is_visible()
    # A duplicate legacy listener would toggle twice and leave the state unchanged.
    collapse = page.locator('#ucollapse')
    initial = collapse.get_attribute('aria-expanded')
    collapse.focus(); page.keyboard.press('Enter')
    assert collapse.get_attribute('aria-expanded') != initial
    collapse.focus(); page.keyboard.press('Enter')
    assert collapse.get_attribute('aria-expanded') == initial
    page.locator('#projects-utab-assistant').focus(); page.keyboard.press('Enter')
    page.screenshot(path=str(out / f'utility-diagnostic-{enabled}-{stored}.png'), full_page=True)
    page.locator('#projects-upane-assistant').wait_for(state='visible', timeout=3000)
    page.locator('#probe-direct').click()
    assert page.evaluate('directClicks') == (2 if enabled else 1)
    assert page.locator('textarea[aria-label="Retained assistance draft"]').input_value() == 'Nội dung đang soạn'
    widths = []
    for width in [390, 980, 1600]:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.screenshot(path=str(out / f'legacy-{enabled}-{stored}-{width}.png'), full_page=True)
        widths.append(width)
        assert page.locator('[data-projects-ui="v2"]').count() == 0
        assert page.locator('dialog:modal').count() == 0
    page.set_viewport_size({'width': 1600, 'height': 1000})
    page.evaluate('(window.rollback||presentation).dispose(); (window.rollbackScale||window.legacyScale).dispose()')
    state = collapse.get_attribute('aria-expanded')
    collapse.focus(); page.keyboard.press('Enter')
    assert collapse.get_attribute('aria-expanded') == state, 'disposed handler still reacts'
    assert page.evaluate('storage.getItem("crm:projects:ui-scale")') == stored
    assert page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size===document.querySelectorAll("[id]").length')
    return {'initialV2': enabled, 'legacyPreference': stored, 'legacyZoom': expected, 'widths': widths,
            'singleOwner': True, 'disposedHandlerInactive': True, 'retainedDraft': True,
            'taskMutations': page.evaluate('calls.filter(c=>c.method!=="GET").length'), 'before': before}


if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).with_name('v2-shell-browser-check.py')))['main'](check=check)
