"""PR08 synthetic Chrome: real board/views/detail controllers, no login or backend."""
import argparse
import hashlib
import json
import re
import runpy
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    hashes, results, errors = {}, [], []

    def source(name):
        data = (root / name).read_bytes()
        hashes[name] = hashlib.sha256(data).hexdigest()
        return data.decode('utf-8')

    panel = runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']()
    panel.feed(source('public/crm-admin.html'))
    html = '<!doctype html><html><body class="crm-admin">' + ''.join(panel.parts) + '</body></html>'
    bindings = dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)", source('public/crm-admin.js')))
    def open_fixture(context, url):
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=html) if route.request.resource_type == 'document' else route.abort())
        page.goto(url)
        for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
            page.add_style_tag(content=source('public/' + name))
        page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
        page.evaluate("document.querySelector('[data-panel=projects]').dataset.projectsUi='v2'")
        for name in ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'views', 'workspace', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']:
            page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
        page.add_script_tag(content=source('tests/fixtures/crm/projects-v2-views.js'))
        page.evaluate('async bindings => { window.h = await createProjectsViewsFixture(bindings); }', bindings)
        page.wait_for_load_state('networkidle')
        return page

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            for width in [1280, 980]:
                context = browser.new_context(viewport={'width': width, 'height': 900}, has_touch=True)
                page = open_fixture(context, 'https://fixture.invalid/crm-admin.html?keep=yes&pjProject=p&pjView=kanban#projects')
                page.wait_for_selector('[data-task-open="p0"]')
                assert 'Nguyễn Thị Huyền <b>' in page.locator('[data-task-open="p0"]').text_content()
                assert page.locator('[data-task-open="p0"] b').count() == 0
                assert page.locator('[data-kanban-task="p0"] [data-priority-column="priority-custom-123"]').text_content() == 'High'
                assert page.locator('[data-kanban-task="p0"] .crm-projects-kanban-sec').text_content() == 'Công việc'
                assert page.locator('[data-kanban-task="p4"] .crm-projects-kanban-ancestors').inner_text() == 'Parent context'
                for control in ['#projects-board-group-by','#projects-v2-columns','#btn-projects-board-add-column']:
                    assert page.locator(control).is_hidden()
                # Native keyboard select uses the same canonical command as pointer/drag.
                status = page.locator('[data-task-status="p0"]')
                status.focus()
                page.keyboard.press('End')
                page.keyboard.press('Enter')
                page.wait_for_function("h.tasks[0].status==='done' && h.views.getState().response.tasks.find(t=>t.id==='p0').revision===2")
                page.wait_for_function("!document.querySelector('[data-task-status=p0]').disabled")
                assert page.evaluate("h.calls.filter(c=>c.method==='PATCH').length") == 1
                assert page.evaluate("h.board.getState().selectedTaskId") == ''
                assert page.locator('[data-status-column="done"] [data-task-open="p0"]').count() == 1
                page.screenshot(path=str(out / f'kanban-{width}.png'))
                # A filter is shared by all five views; no hidden-view mutation loop.
                page.evaluate("h.views.applyFilters({status:'done',title:'Công việc'})")
                for view in ['board', 'kanban', 'gantt', 'calendar', 'charts']:
                    page.locator(f'#projects-view-tabs [data-view="{view}"]').click()
                    page.wait_for_function('(view)=>h.views.getState().view===view', arg=view)
                    assert page.evaluate("h.board.getState().filters.status") == 'done'
                    assert page.evaluate("h.views.getState().filters.title") == 'Công việc'
                page.evaluate("h.views.setView('kanban')")
                page.wait_for_selector('[data-task-open="p0"]')
                page.locator('[data-task-open="p0"]').focus()
                page.keyboard.press('Enter')
                page.wait_for_function("h.board.getState().selectedTaskId==='p0'")
                assert page.locator('#projects-board-detail').evaluate('e=>e.open')
                assert 'pjTask=p0' in page.url
                # A refetched projection replaces the original opener node.
                page.evaluate('h.views.refresh()')
                page.locator('#btn-projects-board-close-detail').click()
                page.wait_for_function("document.activeElement.dataset.taskOpen==='p0'")
                page.keyboard.press('Enter')
                page.wait_for_function("h.board.getState().selectedTaskId==='p0'")
                page.locator('[data-detail-tab="updates"]').click()
                page.wait_for_function("new URL(location.href).searchParams.get('pjTab')==='updates'")
                page.screenshot(path=str(out / f'detail-{width}.png'))
                writes = page.evaluate("h.calls.filter(c=>c.method!=='GET').length")
                page.go_back()
                page.wait_for_function("h.board.getState().selectedTaskId===''")
                page.go_forward()
                page.wait_for_function("h.board.getState().selectedTaskId==='p0'")
                assert page.locator('[data-detail-tab="updates"]').get_attribute('aria-selected') == 'true'
                assert page.evaluate("h.calls.filter(c=>c.method!=='GET').length") == writes
                page.locator('#btn-projects-board-close-detail').click()
                # Deep-link project switch, missing task, stale result and access loss.
                page.evaluate("history.pushState(history.state,'','?keep=yes&pjProject=q&pjView=calendar&pjTask=q1&pjTab=details#projects');h.views.restoreNavigation()")
                page.wait_for_function("h.board.getState().selectedTaskId==='q1'")
                assert page.evaluate("h.board.getState().project.id") == 'q'
                page.evaluate("() => { h.release=h.hold('/tasks/q0');h.stale=h.views.openTask('q0'); }")
                page.evaluate("h.views.openTask('q2')")
                page.wait_for_function("h.board.getState().selectedTaskId==='q2'")
                page.evaluate('h.release();h.stale')
                assert page.evaluate("h.board.getState().selectedTaskId") == 'q2'
                page.evaluate("h.tasks=h.tasks.filter(t=>t.id!=='q2');h.views.refresh()")
                page.wait_for_function("h.board.getState().selectedTaskId===''")
                page.evaluate("h.views.openTask('q1')")
                page.wait_for_function("h.board.getState().selectedTaskId==='q1'")
                page.evaluate("h.denied='q';h.views.refresh()")
                page.wait_for_function("h.views.getState().projectId===''")
                assert not page.locator('#projects-board-detail').evaluate('e=>e.open')
                assert page.locator('#projects-task-planning').text_content() == ''
                assert 'pjTask=' not in page.url
                page.screenshot(path=str(out / f'access-cleared-{width}.png'))
                results.append({'width': width, 'passed': True, 'writes': writes, 'cases': ['keyboard canonical command', 'Vietnamese escaped title', 'five shared filters', 'task open and tab', 'Back/forward', 'cross-project deep link', 'delayed stale open', 'missing task', 'access loss']})
                page.evaluate('h.close()')
                context.close()
            # Separate fresh fixtures keep both review repros independent of any
            # resize/scroll/observer event and of the original workflow above.
            for width in [1280, 980]:
                for flow in ['disappearance', 'newer-revision']:
                    context = browser.new_context(viewport={'width': width, 'height': 900})
                    page = open_fixture(context, 'https://fixture.invalid/crm-admin.html?keep=yes#projects')
                    page.wait_for_selector('#projects-board-rows [data-task-id="p0"]')
                    if flow == 'disappearance':
                        page.locator('#projects-board-rows [data-task-id="p0"]').focus()
                        page.evaluate("h.board.setSelectedTaskIds(['p0','p2']);h.tasks=h.tasks.filter(t=>t.id!=='p0')")
                        page.evaluate("history.pushState(null,'','?pjProject=p&pjView=board&pjTask=p0#projects');h.views.restoreNavigation()")
                        assert page.locator('#projects-board-rows [data-task-id="p0"]').count() == 0
                        assert page.evaluate("h.board.getState().tasks.has('p0')") is False
                        assert page.evaluate("h.board.getState().selectedTaskId") == ''
                        assert page.evaluate("Array.from(h.board.getState().selectedTaskIds)") == ['p2']
                        assert page.evaluate("document.activeElement.dataset.taskId") == 'p1'
                        assert 'unavailable' in page.locator('#projects-view-status').text_content().lower()
                        assert page.locator('#projects-view-summary').text_content() == ''
                    else:
                        page.locator('#projects-view-tabs [data-view="kanban"]').click()
                        page.wait_for_selector('[data-task-open="p0"]')
                        page.evaluate("Object.assign(h.tasks[0],{revision:2,status:'done',title:'Remote title revision two'});h.views.refresh()")
                        assert page.locator('[data-status-column="done"] [data-task-open="p0"]').count() == 1
                        reads = page.evaluate("h.calls.filter(c=>c.url.includes('/tasks?')).length")
                        page.evaluate("() => { h.release=h.hold('/tasks?'); }")
                        page.locator('#projects-view-tabs [data-view="board"]').click()
                        page.wait_for_function("h.calls.filter(c=>c.url.includes('/tasks?')).length>" + str(reads))
                        assert not page.locator('#projects-board-table-wrap').is_visible()
                        page.evaluate('h.release()')
                        page.wait_for_function("h.board.getState().tasks.get('p0').revision===2 && !document.querySelector('#projects-board-table-wrap').hidden")
                        row = page.locator('#projects-board-rows [data-task-id="p0"]')
                        assert 'Remote title revision two' in row.text_content()
                        assert page.evaluate("h.board.getState().tasks.get('p0').status") == 'done'
                        assert page.evaluate("h.board.getState().tasks.has('p4')") is False
                        assert page.evaluate("h.calls.filter(c=>c.url.includes('/tasks?')).length") == reads + 1
                    page.screenshot(path=str(out / f'{flow}-{width}.png'))
                    results.append({'width': width, 'flow': flow, 'passed': True, 'observer': 'deliberately not delivered; canonical API responses only'})
                    page.evaluate('h.close()')
                    context.close()
        finally:
            browser.close()
    assert not errors, errors
    (out / 'report.json').write_text(json.dumps({'results': results, 'pageErrors': errors, 'sourceHashes': hashes, 'limits': 'Synthetic API; no authenticated backend, persistence or production evidence.'}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'pageErrors': errors}))


if __name__ == '__main__':
    main()
