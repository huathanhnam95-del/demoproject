"""Chrome-only PR03 shell check: production controllers, synthetic API, no authentication/persistence claim."""
import argparse
import hashlib
import json
import re
import runpy
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright


def main(check=None):
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--out', required=True)
    args.add_argument('--legacy-base', help='Capture flag-off behavior from this Git revision for comparison')
    args.add_argument('--size', type=int, default=5000, choices=[30, 500, 5000])
    options = args.parse_args()
    root = Path(__file__).resolve().parents[3]
    out = Path(options.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    hashes = {}

    def source(p):
        if options.legacy_base:
            result = subprocess.run(['git', 'show', f'{options.legacy_base}:{p}'], cwd=root, capture_output=True)
            if result.returncode:
                assert p.endswith(('crm-projects-v2.css', 'presentation/ui-preferences.js', 'presentation/shell.js')), p
                return '/* Asset absent from the legacy base. */'
            value = result.stdout.decode('utf-8')
        else:
            value = (root / p).read_text(encoding='utf-8')
        hashes[p] = hashlib.sha256(value.encode()).hexdigest()
        return value

    panel_parser = runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']()
    panel_parser.feed(source('public/crm-admin.html'))
    markup = ''.join(panel_parser.parts)
    bindings = dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)", source('public/crm-admin.js')))
    fixture = json.loads(subprocess.check_output(['node', '-e', f"process.stdout.write(JSON.stringify(require('./tests/fixtures/crm/projects-v2').createFixture({options.size})))"], cwd=root))
    errors, results = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            cases = [(False, '150')] if options.legacy_base else [(False, '150'), (True, None), (True, '125'), (True, '150')]
            for enabled, stored in cases:
                context = browser.new_context(viewport={'width': 1600, 'height': 1000})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/*', lambda route: route.abort())
                page.set_content('<!doctype html><html><body class="crm-admin">' + markup + '</body></html>')
                for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
                    page.add_style_tag(content=source('public/' + name))
                page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
                for name in ['presentation/column-model', 'presentation/table-layout', 'state', 'presentation/detail-surface', 'board', 'workspace', 'ui-scale', 'notifications', 'recovery', 'presentation/field-feedback', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']:
                    page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
                page.evaluate('''({enabled, stored, data, bindings})=>{
                    const panel=document.querySelector('[data-panel="projects"]');
                    const elements=Object.fromEntries(Object.entries(bindings).map(([k,id])=>[k,document.getElementById(id)]));
                    const records=new Map(stored===null?[]:[['crm:projects:ui-scale',stored]]);
                    window.storage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v)};
                    window.calls=[];window.actor='crm-projects-teacher';
                    const getCurrentUser=()=>({uid:window.actor});
                    const api=async(url,options)=>{
                        calls.push({url,method:options?.method||'GET'});
                        if(url.includes('notification-preferences'))return {preferences:{revision:1,muted:[]}};
                        if(url.includes('notifications'))return {notifications:[],items:[]};
                        if(url.includes('/recovery'))return {entries:[]};
                        if(url.includes('member-directory'))return {people:data.people};
                        if(url.includes('/tasks?')){const parent=JSON.parse(new URL(url,'https://fixture.invalid').searchParams.get('filters')||'{}').parentTaskId;return {tasks:data.tasks.filter(t=>(parent?t.parentTaskId===parent:!t.parentTaskId)&&t.lifecycle==='active'),sections:data.sections,columns:data.columns,revision:{schemaRevision:1,structureRevision:1}};}
                        return {project:data.projects.find(p=>p.id===url.split('/').pop()),membership:{role:'Owner'}};
                    };
                    const notifications=CrmProjectsNotifications.createController({root:document.getElementById('projects-notifications'),getCurrentUser,apiFetchJson:api});notifications.init();notifications.setAccount(actor);notifications.setProjects(data.projects);
                    const recovery=CrmProjectsRecovery.createController({elements,getCurrentUser,apiFetchJson:api});recovery.init();
                    window.board=CrmProjectsBoard.createController({presentationV2:enabled,presentationStorage:storage,elements,getCurrentUser,apiFetchJson:api,onContextChanged:s=>window.presentation?.setContext(s),onFieldSaveScopeChanged:s=>window.presentation?.setFieldSaveScope?.(s)});
                    document.getElementById('projects-assistant').innerHTML='<textarea aria-label="Retained assistance draft">Nội dung đang soạn</textarea><button id="probe-direct">Direct listener</button>';
                    window.directClicks=0;document.getElementById('probe-direct').addEventListener('click',()=>directClicks++);
                    window.activationCalls=0;
                    const automate=document.getElementById('btn-projects-automate');automate.hidden=false;automate.disabled=false;automate.addEventListener('click',()=>activationCalls++);
                    document.getElementById('projects-automations').hidden=false;
                    document.getElementById('projects-automations').innerHTML='<p>Automation controller host fixture</p>';
                    window.originalPane=document.getElementById('projects-upane-assistant');
                    const selection={projects:data.projects,selectedProjectId:'v2-a'};
                    const createWorkspace=opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser});
                    window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:enabled},panel,getCurrentUser,storage,onDensity:(mode,scale)=>board.setDensity(mode,scale),onDisposePresentation:()=>board.disposePresentation(),openAutomations:()=>activationCalls++,createWorkspace});
                    document.getElementById('btn-projects-density').addEventListener('click',()=>{
                        const compact=document.getElementById('btn-projects-density').getAttribute('aria-pressed')==='true';
                        if(enabled)presentation.preferences.setDensity(compact?'comfortable':'compact');
                        else {document.getElementById('btn-projects-density').setAttribute('aria-pressed',String(!compact));board.setDensity(compact?'comfortable':'compact');}
                    });
                    if(!enabled)window.legacyScale=CrmProjectsUiScale.init({elements,panel,storage});
                    board.init();presentation.init();presentation.init();presentation.setSelection(selection);board.setProjects(selection);
                }''', {'enabled': enabled, 'stored': stored, 'data': fixture, 'bindings': bindings})
                page.wait_for_function('board.getState().authorizationReady')
                page.wait_for_load_state('networkidle')
                assert page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size===document.querySelectorAll("[id]").length')
                assert page.locator('[data-projects-ui="v2"]').count() == int(enabled)
                assert page.evaluate('storage.getItem("crm:projects:ui-scale")') == stored
                if check:
                    results.append(check(page, enabled, stored, out, options.size))
                    context.close()
                    continue
                if enabled:
                    assert page.locator('#projects-utility-rail').is_hidden()
                    expected_font = 14 * (float(stored or '100') / 100)
                    actual_font = page.locator('.crm-board-status-text').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')
                    assert abs(actual_font-expected_font) < 0.1, (actual_font, expected_font)
                    assert page.locator('#crm-projects-view-portal-host').count() == 0
                    assert page.locator('[data-panel="projects"]').evaluate('e=>getComputedStyle(e).zoom') == '1'
                    page.locator('#projects-utab-assistant').click()
                    assert page.locator('#projects-board-section').is_hidden()
                    assert page.locator('#probe-direct').is_visible()
                    page.locator('#probe-direct').click()
                    assert page.evaluate('directClicks') == 1
                    assert page.locator('textarea[aria-label="Retained assistance draft"]').input_value() == 'Nội dung đang soạn'
                    for utility in ['notifications', 'recovery', 'automations']:
                        page.locator('#projects-utab-' + utility).click()
                        assert page.locator('#projects-upane-' + utility).is_visible()
                    page.locator('#btn-projects-automate').click()
                    assert page.evaluate('activationCalls') == 2, 'one nav and one header activation'
                    page.locator('#projects-v2-table').click()
                    assert page.locator('#projects-board-section').is_visible()
                    page.locator('#projects-v2-members').click()
                    assert page.locator('[data-projects-settings-panel="members"]').is_visible()
                    assert page.locator('#projects-workspace-settings').evaluate('d=>d.open')
                    page.keyboard.press('Escape')
                    assert page.locator('#projects-workspace-settings').is_hidden()
                sizes = []
                for width in [390, 700, 980, 1280, 1600]:
                    page.set_viewport_size({'width': 1600, 'height': 1000})
                    page.locator('[data-panel="projects"]').evaluate('(e,width)=>e.style.width=(width/Number(getComputedStyle(e).zoom||1))+"px"', width)
                    page.wait_for_function('(width)=>Math.abs(document.querySelector("[data-panel=projects]").getBoundingClientRect().width-width)<2', arg=width)
                    if enabled:
                        assert page.locator('#projects-workspace-rail-toggle').is_visible() == (width < 1100)
                    page.mouse.move(1599, 999)
                    page.screenshot(path=str(out/f'{enabled}-{stored}-{width}.png'), full_page=True)
                    sizes.append(page.locator('[data-panel="projects"]').evaluate('e=>e.getBoundingClientRect().width'))
                if enabled:
                    for keyboard_width in [1600, 390]:
                        page.locator('[data-panel="projects"]').evaluate('(e,w)=>e.style.width=w+"px"', keyboard_width)
                        page.wait_for_function('(n)=>document.querySelector("[data-panel=projects]").dataset.projectsNarrow===String(n)', arg=keyboard_width < 1100)
                        if keyboard_width < 1100:
                            page.locator('#projects-workspace-rail-toggle').click()
                        page.locator('#projects-utab-assistant').focus()
                        expected_activations = page.evaluate('activationCalls')
                        for key, name in [('ArrowDown','notifications'), ('ArrowDown','automations'), ('End','recovery'), ('ArrowDown','assistant'), ('ArrowUp','recovery'), ('Home','assistant'), ('End','recovery'), ('ArrowUp','automations')]:
                            page.keyboard.press(key)
                            tab = page.locator('#projects-utab-' + name)
                            assert tab.evaluate('e=>e===document.activeElement'), (keyboard_width, key, name)
                            assert tab.get_attribute('aria-selected') == 'true'
                            assert page.locator('#projects-upane-' + name).is_visible()
                            if keyboard_width < 1100:
                                assert page.locator('#projects-workspace-rail-toggle').get_attribute('aria-expanded') == 'true'
                                assert tab.is_visible()
                            if name == 'automations':
                                expected_activations += 1
                            assert page.evaluate('activationCalls') == expected_activations
                        # Native Enter/Space activation still enters the pane and closes the sidebar.
                        for activation_key in ['Enter', 'Space']:
                            page.keyboard.press(activation_key)
                            expected_activations += 1
                            assert page.evaluate('activationCalls') == expected_activations
                            assert page.locator('#projects-upane-automations').evaluate('e=>e===document.activeElement')
                            if keyboard_width < 1100:
                                assert page.locator('#projects-workspace-rail-toggle').get_attribute('aria-expanded') == 'false'
                                page.locator('#projects-workspace-rail-toggle').click()
                            page.locator('#projects-utab-automations').focus()
                        page.screenshot(path=str(out/f'keyboard-{stored}-{keyboard_width}.png'), full_page=True)
                    page.locator('[data-panel="projects"]').evaluate('e=>e.style.width="1600px"')
                    page.wait_for_function('document.querySelector("[data-panel=projects]").dataset.projectsNarrow==="false"')
                    page.locator('#projects-v2-table').click()
                    page.locator('#projects-board-scroll').evaluate('e=>e.scrollTop=e.scrollHeight-e.clientHeight-100')
                    anchor_before = page.evaluate('document.getElementById("projects-board-scroll").scrollTop / parseFloat(document.querySelector("[data-row-kind=task]").style.height)')
                    page.locator('.crm-projects-view-options > summary').click()
                    page.locator('#projects-ui-scale').fill('150')
                    page.locator('#projects-ui-scale').dispatch_event('input')
                    print('anchor-diagnostic', stored, anchor_before, page.locator('#projects-board-scroll').evaluate('e=>({top:e.scrollTop,max:e.scrollHeight-e.clientHeight,row:document.querySelector("[data-row-kind=task]").style.height})'), flush=True)
                    page.locator('#btn-projects-density').click()
                    page.keyboard.press('Escape')
                    row_height = page.locator('[data-row-kind="task"]').first.evaluate('e=>e.getBoundingClientRect().height')
                    assert row_height == 54, row_height
                    scroll_metrics = page.locator('#projects-board-scroll').evaluate('e=>({top:e.scrollTop,max:e.scrollHeight-e.clientHeight})')
                    expected_top = min(anchor_before * 54, scroll_metrics['max'])
                    assert abs(scroll_metrics['top']-expected_top) < 1, ('density lost scroll anchor', anchor_before, scroll_metrics, expected_top)
                    page.locator('#projects-board-scroll').evaluate('e=>e.scrollTop=e.scrollHeight')
                    page.wait_for_function('()=>[...document.querySelectorAll("[data-row-kind=task]")].some(e=>Number(e.dataset.taskId.slice(1))>85)')
                    assert page.locator('[data-row-kind="task"]').count() < 100
                    assert page.locator('[data-row-kind="task"]').last.evaluate('e=>e.getBoundingClientRect().height') == 54
                    page.set_viewport_size({'width':390,'height':844})
                    page.locator('[data-panel="projects"]').evaluate('e=>e.style.width="390px"')
                    page.locator('#projects-workspace-rail-toggle').click()
                    page.keyboard.press('Escape')
                    assert page.locator('#projects-workspace-rail-toggle').evaluate('e=>e===document.activeElement')
                    # 200% layout/visual zoom surrogate; retain normal browser zoom controls.
                    page.locator('[data-panel="projects"]').evaluate('e=>{e.style.width="800px";document.body.style.zoom="2";}')
                    page.set_viewport_size({'width':1600,'height':1000})
                    page.screenshot(path=str(out/f'zoom200-{stored}.png'),full_page=True)
                    page.evaluate('document.body.style.zoom="";presentation.dispose();presentation.dispose()')
                    assert page.evaluate('document.getElementById("projects-upane-assistant")===originalPane')
                    assert page.locator('#projects-utility-page').count() == 0
                    assert page.locator('[data-projects-ui="v2"]').count() == 0
                    page.evaluate('''() => {
                        const panel=document.querySelector('[data-panel="projects"]');
                        window.rollback=CrmProjectsPresentationV2.createController({config:{projectsV2:false},panel,createWorkspace:()=>CrmProjectsWorkspace.createController({getCurrentUser:()=>({uid:actor})})});
                        rollback.init();window.rollbackScale=CrmProjectsUiScale.init({panel,storage});
                    }''')
                    expected_zoom = str(float(stored or '125') / 100)
                    assert float(page.locator('[data-panel="projects"]').evaluate('e=>getComputedStyle(e).zoom')) == float(expected_zoom)
                    assert page.locator('#projects-board-table-wrap').evaluate('e=>e.style.getPropertyValue("--pj-row-h")') == ''
                    assert page.locator('label[for="projects-ui-scale"]').text_content() == 'Interface size'
                    page.evaluate('rollback.dispose();rollbackScale.dispose()')
                results.append({'v2':enabled,'legacy':stored,'actualWidths':sizes,'requests':page.evaluate('calls')})
                context.close()
        finally:
            browser.close()
    (out/'report.json').write_text(json.dumps({'results':results,'errors':errors,'hashes':hashes,'scope':'Synthetic Chrome shell; actual notifications/recovery controllers; assistant/automation host sentinels; zoom200 is a layout surrogate, not browser UI zoom'},ensure_ascii=False,indent=2),encoding='utf-8')
    assert not errors, errors
    print(f'PASS: {len(results)} shell/migration cases, widths, utilities, density, disposal; {out}')


if __name__ == '__main__':
    main()
