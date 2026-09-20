"""PR09 synthetic Chrome workflows using the shipped Projects shell and automation controller."""
import argparse
import hashlib
import json
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
        return data.decode('utf-8-sig')

    panel = runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']()
    panel.feed(source('public/crm-admin.html'))
    html = '<!doctype html><meta charset="utf-8"><body class="crm-admin">' + ''.join(panel.parts) + '</body>'
    def setup(context):
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=html) if route.request.resource_type == 'document' else route.abort())
        page.goto('https://fixture.invalid/crm-admin.html?keep=yes#projects')
        for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
            page.add_style_tag(content=source('public/' + name))
        page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
        page.evaluate("document.querySelector('[data-panel=projects]').dataset.projectsUi='v2'")
        for name in ['automation-definition-editor', 'automations-renderer', 'automations', 'presentation/shell']:
            page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
        page.add_script_tag(content=source('tests/fixtures/crm/projects-v2-automations.js'))
        page.evaluate('async()=>{window.h=await createProjectsAutomationsFixture()}')
        page.wait_for_load_state('networkidle')
        return page

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            for width in [390, 700, 980, 1280]:
                context = browser.new_context(viewport={'width': width, 'height': 900})
                page = setup(context)
                auto = page.locator('#projects-automations')
                action = lambda name: auto.locator(f'[data-auto-action="{name}"]')
                assert 'Active: v1' in auto.inner_text() and 'Candidate: v2' in auto.inner_text()
                assert auto.locator('.crm-auto-manage-list b').count() == 0
                assert auto.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                page.screenshot(path=str(out / f'manage-{width}.png'), full_page=True)
                action('open-rule').focus()
                page.keyboard.press('Enter')
                page.wait_for_selector('#auto-title')
                assert page.evaluate('h.controller.getState().version.versionId') == 'v2'
                title = auto.locator('#auto-title')
                title.fill('Bản nháp tiếng Việt được giữ nguyên')
                title.evaluate('(e)=>{e.focus();e.setSelectionRange(4,9)}')
                page.evaluate('h.controller.setContext(h.snapshot())')
                assert title.evaluate('(e)=>e===document.activeElement && e.selectionStart===4 && e.selectionEnd===9')
                action('manage').click()
                assert action('create').is_disabled() and action('apply-recipe').first.is_disabled()
                action('close').click()
                assert page.locator('#projects-board-section').is_visible()
                assert page.evaluate("document.activeElement.id==='btn-projects-automate'")
                page.locator('#btn-projects-automate').click()
                action('resume').click()
                assert title.input_value() == 'Bản nháp tiếng Việt được giữ nguyên'
                assert page.evaluate("document.activeElement.id==='auto-title'")
                # Metadata updates retain the current saved version; no engine activation.
                action('metadata').click()
                page.wait_for_function('!h.controller.getState().inFlight')
                assert page.evaluate('h.rule.currentVersion') == 'v1'
                action('versions').click()
                auto.locator('[data-auto-action=history-version]').first.click()
                assert 'Inspecting version v1' in auto.inner_text()
                assert page.evaluate('h.controller.getState().version.versionId') == 'v2'
                assert auto.locator('[data-auto-history-definition] fieldset').evaluate('(e)=>e.disabled')
                page.screenshot(path=str(out / f'history-{width}.png'), full_page=True)
                page.keyboard.press('Escape')
                assert page.evaluate("document.activeElement.dataset.autoAction==='versions'")
                action('runs').click()
                action('history-run').click()
                page.wait_for_function('!!h.controller.getState().history.run')
                assert 'Version: v1' in auto.inner_text() and 'waiting' in auto.inner_text()
                action('close-history').click()
                action('sample-search').click()
                auto.locator('input[name=query]').fill('Nguyễn')
                auto.locator('[data-auto-form=task-search] button[type=submit]').click()
                action('choose-task').click()
                action('preview').click()
                page.wait_for_function('!!h.controller.getState().preview')
                assert page.evaluate('h.applied.length') == 1  # metadata only
                assert 'no notifications were sent' in auto.inner_text()
                assert 'token-' not in auto.inner_text()
                page.screenshot(path=str(out / f'preview-{width}.png'), full_page=True)
                action('activate').click()
                assert page.evaluate('h.applied.length') == 1
                assert page.evaluate("document.activeElement.dataset.autoAction==='confirm-activate'")
                page.keyboard.press('Escape')
                assert page.evaluate("document.activeElement.dataset.autoAction==='activate'")
                # The expiry guard is evaluated again after the review has opened.
                action('activate').click()
                page.evaluate("window.originalNow=Date.now;Date.now=()=>Date.parse('3000-01-01')")
                action('confirm-activate').click()
                assert page.evaluate('h.applied.length') == 1
                page.evaluate('Date.now=originalNow')
                action('preview').click()
                page.evaluate("h.failures.push({match:'/activate',status:503,code:'Lost acknowledgement',after:true})")
                action('activate').click()
                page.screenshot(path=str(out / f'activation-{width}.png'), full_page=True)
                action('confirm-activate').click()
                page.wait_for_function('!!h.controller.getState().pending && !h.controller.getState().inFlight')
                assert page.evaluate('h.applied.length') == 2
                message = auto.locator('textarea[data-auto-node="notify-owner"]')
                message.fill('Nội dung mới sau khi bị gián đoạn')
                assert action('save').is_disabled() and action('duplicate').is_disabled()
                action('retry-mutation').click()
                page.wait_for_function('!h.controller.getState().pending')
                assert message.input_value() == 'Nội dung mới sau khi bị gián đoạn'
                assert page.evaluate('h.applied.length') == 2
                assert page.evaluate("(()=>{const a=h.calls.filter(x=>x.url.endsWith('/activate'));return a.length===2&&JSON.stringify(a[0].body)===JSON.stringify(a[1].body)})()")
                # Version conflict and retained definition refresh use current expected revision.
                page.evaluate('h.rule.revision=20')
                action('save').click()
                page.wait_for_function('h.controller.getState().conflict')
                action('refresh-rule').click()
                page.wait_for_function('h.controller.getState().rule.revision===20')
                assert message.input_value() == 'Nội dung mới sau khi bị gián đoạn'
                action('save').click()
                page.wait_for_function('!h.controller.getState().dirty')
                assert page.evaluate('h.rule.currentVersion') == 'v2'
                assert page.evaluate('h.rule.candidateVersion') == 'v3'
                page.screenshot(path=str(out / f'editor-{width}.png'), full_page=True)
                assert auto.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                # Old history response cannot fill a newly selected section.
                page.evaluate("async()=>{await h.controller.loadHistory('runs');window.release=h.hold('/automation-runs/');window.work=h.controller.showRun('run');await h.controller.loadHistory('versions');release();await work}")
                assert page.evaluate('!h.controller.getState().history.run')
                action('close-history').click()
                # Delayed preview is discarded after schema drift, then Owner denial clears content.
                page.evaluate("async()=>{window.release=h.hold('/preview','POST');window.work=h.controller.generatePreview();h.controller.setContext(h.snapshot({columns:[{id:'new',type:'text'}]}));release();await work}")
                assert page.evaluate('h.controller.getState().preview===null')
                assert action('activate').is_disabled()
                page.evaluate('h.controller.setContext(h.snapshot())')
                action('preview').click()
                page.evaluate("h.failures.push({match:'/activate',status:403,code:'PROJECT_OWNER_REQUIRED'})")
                action('activate').click()
                action('confirm-activate').click()
                page.wait_for_function('!h.controller.getState().owner')
                assert page.evaluate('h.controller.getState().draft===null')
                assert auto.locator('#auto-title').count() == 0
                assert 'Project Owners' in auto.inner_text()
                results.append({'width': width, 'passed': True, 'activationWrites': 3, 'source': 'real controller and shell, synthetic API'})
                page.close()
                for drift in ['actor', 'definition', 'both']:
                    page = setup(context)
                    auto = page.locator('#projects-automations')
                    action = lambda name: auto.locator(f'[data-auto-action="{name}"]')
                    page.evaluate('async()=>{await h.open();await h.sample();await h.controller.generatePreview()}')
                    action('activate').click()
                    page.evaluate("window.oldConfirm=document.querySelector('[data-auto-action=confirm-activate]')")
                    auto.locator('#auto-title').fill('Tên nháp tiếng Việt giữ nguyên')
                    auto.locator('#auto-folder').fill('Thư mục chưa lưu')
                    page.evaluate("""drift=>{
                        window.retained=JSON.stringify(h.controller.getState().draft);
                        const definition=JSON.parse(JSON.stringify(h.definition));
                        if(drift!=='actor')definition.steps[0].payload.message='Định nghĩa khác của chủ dự án';
                        h.publishCandidate({actorUid:drift==='definition'?'owner':'owner2',definition});
                    }""", drift)
                    action('refresh-rule').click()
                    page.wait_for_function("h.controller.getState().version.versionId==='v3'")
                    assert page.evaluate('JSON.stringify(h.controller.getState().draft)===retained')
                    assert page.evaluate('h.controller.getState().dirty')
                    assert auto.locator('#auto-actor').input_value() == 'owner'
                    assert 'Draft based on version' in auto.inner_text() and 'unsaved changes' in auto.inner_text()
                    assert action('preview').is_disabled() and action('activate').is_disabled()
                    assert auto.locator('[data-auto-action=confirm-activate]').count() == 0
                    page.evaluate('async()=>{oldConfirm.click();await h.controller.generatePreview();await h.controller.mutate("activate")}')
                    assert page.evaluate("h.calls.filter(x=>x.url.endsWith('/preview')).length") == 1
                    assert page.evaluate("h.calls.filter(x=>x.url.endsWith('/activate')).length") == 0
                    assert auto.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                    page.screenshot(path=str(out / f'retained-{drift}-{width}.png'), full_page=True)
                    # The Owner deliberately saves the retained actor and definition as v4.
                    action('save').click()
                    page.wait_for_function("h.controller.getState().version.versionId==='v4' && !h.controller.getState().inFlight")
                    assert page.evaluate("!h.controller.getState().dirty && h.rule.currentVersion==='v1'")
                    assert page.evaluate("h.versions.at(-1).actorUid==='owner' && JSON.stringify(h.versions.at(-1).definition)===JSON.stringify(JSON.parse(retained).definition)")
                    assert auto.locator('#auto-title').input_value() == 'Tên nháp tiếng Việt giữ nguyên'
                    assert auto.locator('#auto-folder').input_value() == 'Thư mục chưa lưu'
                    action('preview').click()
                    page.wait_for_function("h.controller.getState().preview?.versionId==='v4'")
                    action('activate').click()
                    assert page.evaluate("h.calls.filter(x=>x.url.endsWith('/activate')).length") == 0
                    action('confirm-activate').click()
                    page.wait_for_function("h.rule.currentVersion==='v4' && !h.controller.getState().inFlight")
                    assert page.evaluate("h.rule.activeActorUid==='owner' && h.calls.filter(x=>x.url.endsWith('/activate')).length===1")
                    assert page.evaluate("h.calls.find(x=>x.url.endsWith('/activate')).body.expectedRevision") == 6
                    page.screenshot(path=str(out / f'reconciled-{drift}-{width}.png'), full_page=True)
                    results.append({'width': width, 'case': f'retained-{drift}', 'passed': True,
                                    'savedVersion': 'v4', 'savedActor': 'owner', 'activationWrites': 1})
                    if drift == 'both':
                        for order in ['page-first', 'run-first']:
                            page.evaluate("async()=>{h.paginateRuns=true;await h.controller.loadHistory('runs');window.releaseRun=h.hold('/automation-runs/');window.releasePage=h.hold('cursor=runs-page-2')}")
                            action('history-run').click()
                            action('more-history').click()
                            assert page.evaluate('h.controller.getState().history.loading && h.controller.getState().history.runLoading')
                            if order == 'page-first':
                                page.evaluate('releasePage()')
                                page.wait_for_function('!h.controller.getState().history.loading')
                                assert page.evaluate('h.controller.getState().history.runLoading')
                                page.evaluate('releaseRun()')
                            else:
                                page.evaluate('releaseRun()')
                                page.wait_for_function('!h.controller.getState().history.runLoading')
                                assert page.evaluate('h.controller.getState().history.loading')
                                page.evaluate('releasePage()')
                            page.wait_for_function('!h.controller.getState().history.runLoading && !h.controller.getState().history.loading')
                            assert page.evaluate("h.controller.getState().history.items.map(x=>x.runId).join(',')==='run,run-next'")
                            assert page.evaluate("h.controller.getState().history.run.run.runId==='run' && h.controller.getState().history.run.versionId==='v1'")
                            assert page.evaluate("h.controller.getState().version.versionId==='v4'")
                            assert 'Loading run details' not in auto.inner_text()
                            page.screenshot(path=str(out / f'pagination-{order}-{width}.png'), full_page=True)
                            results.append({'width': width, 'case': order, 'passed': True, 'selectedRun': 'run', 'runVersion': 'v1'})
                        for destination in ['versions', 'close-history', 'close']:
                            page.evaluate("async()=>{await h.controller.loadHistory('runs');window.releaseRun=h.hold('/automation-runs/');window.runWork=h.controller.showRun('run');window.releasePage=h.hold('cursor=runs-page-2');window.pageWork=h.controller.loadHistory('runs',true)}")
                            action(destination).click()
                            page.evaluate('async()=>{releasePage();releaseRun();await Promise.all([pageWork,runWork])}')
                            assert page.evaluate('!h.controller.getState().history.run && !h.controller.getState().history.runLoading && !h.controller.getState().history.loading')
                            assert page.evaluate('h.controller.getState().history.kind') == ('versions' if destination == 'versions' else '')
                            assert page.evaluate("h.controller.getState().version.versionId==='v4'")
                            if destination == 'close':
                                assert page.locator('#projects-board-section').is_visible()
                                assert page.evaluate("document.activeElement.id==='btn-projects-automate'")
                            results.append({'width': width, 'case': f'pending-pagination-{destination}', 'passed': True})
                    page.close()
                context.close()
            assert not errors, errors
            (out / 'report.json').write_text(json.dumps({'results': results, 'pageErrors': errors, 'sourceHashes': hashes, 'browser': browser.version, 'limitations': 'Synthetic local API; no authenticated bootstrap, real persistence or runtime effects.'}, indent=2), encoding='utf-8')
            print(json.dumps({'passed': len(results), 'pageErrors': errors}))
        finally:
            browser.close()


if __name__ == '__main__':
    main()
