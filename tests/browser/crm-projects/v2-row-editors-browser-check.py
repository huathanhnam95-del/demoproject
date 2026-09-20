"""PR05 synthetic Chrome: real board/shell/editor code, no login or production calls."""
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
    parser.add_argument('--conflict-case', choices=['people', 'dates'])
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
    markup = ''.join(panel.parts)
    bindings = dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)", source('public/crm-admin.js')))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            for width, timezone, touch in [(1600, 'America/Los_Angeles', False), (980, 'Pacific/Kiritimati', False), (390, 'Asia/Ho_Chi_Minh', True)]:
                context = browser.new_context(viewport={'width': width, 'height': 900}, timezone_id=timezone, has_touch=touch)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('**/*', lambda route: route.abort())
                page.set_content('<!doctype html><html><body class="crm-admin">' + markup + '</body></html>')
                for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
                    page.add_style_tag(content=source('public/' + name))
                page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
                for name in ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'date-picker', 'workspace', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']:
                    page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
                page.evaluate('''bindings=>{
                    const elements=Object.fromEntries(Object.entries(bindings).map(([k,id])=>[k,document.getElementById(id)]));
                    window.actor='a';window.role='Owner';window.calls=[];window.fail=0;window.release=null;window.holdNext=false;window.holdRead=false;
                    const people=[{uid:'a',displayName:'Owner A'},{uid:'b',displayName:'Nguyễn Thị B'},{uid:'c',displayName:'Trần C'}];
                    const columns=[{id:'team',label:'Team',type:'people'},{id:'notes',label:'Notes',type:'text'},{id:'number',label:'Estimate',type:'number'},{id:'importance',label:'Priority',type:'priority'},{id:'choice',label:'Choice',type:'dropdown',options:[{key:'yes',label:'Yes'}]}];
                    window.tasks=Array.from({length:80},(_,i)=>({id:`t${i}`,title:`Công việc ${i} <b>`,sectionId:'s',rank:`${i}/1`,revision:1,lifecycle:'active',activeChildCount:i===0?1:0,ownerUid:'a',assigneeUids:['b','former'],startDate:'2026-09-01',dueDate:'2026-09-20',values:{team:['b'],notes:'Original',number:0,importance:'high',choice:'removed'}}));
                    tasks[1].parentTaskId='t0';tasks[1].ancestorIds=['t0'];tasks[1].activeChildCount=1;
                    tasks[2].parentTaskId='t1';tasks[2].ancestorIds=['t0','t1'];
                    let preview=null;
                    const api=async(url,options)=>{
                        const body=options?.body?JSON.parse(options.body):null;calls.push({url,method:options?.method||'GET',body});
                        if(options){
                            if(holdNext){holdNext=false;await new Promise(resolve=>window.release=resolve);}
                            if(fail)throw Object.assign(Error('Synthetic save rejected'),{status:fail});
                            if(url.endsWith('schedule-preview')){const task=tasks.find(t=>t.id===body.taskId);if(task.revision!==body.expectedRevision)throw Object.assign(Error('Task changed'),{status:409});preview={token:'fixture-preview',revision:body.expectedRevision,taskId:body.taskId,canApply:true,workingDayCount:12,warnings:[],after:{startDate:body.startDate,dueDate:body.dueDate}};return {preview};}
                            const id=preview&&url.endsWith('schedule-apply')?preview.taskId:url.split('/').pop();const task=tasks.find(t=>t.id===id);
                            if(!task)throw Error(`Unexpected fixture write ${url}`);
                            if(url.endsWith('schedule-apply')&&task.revision!==preview.revision)throw Object.assign(Error('Task changed'),{status:409});
                            const patch=url.endsWith('schedule-apply')?preview.after:body;
                            if(body.expectedRevision!==undefined&&body.expectedRevision!==task.revision)throw Object.assign(Error('Revision conflict'),{status:409});
                            Object.assign(task,{...patch,values:{...task.values,...patch.values},revision:task.revision+1});return {result:{task:{...task}}};
                        }
                        if(url.includes('member-directory'))return {people};
                        if(url.includes('/tasks?')){const parent=JSON.parse(new URL(url,'https://fixture.invalid').searchParams.get('filters')||'{}').parentTaskId;return {tasks:tasks.filter(t=>parent?t.parentTaskId===parent:!t.parentTaskId),columns,sections:[{id:'s',title:'Section',rank:'0/1'}],revision:{schemaRevision:1,structureRevision:1}};}
                        if(url.endsWith('/tasks/t0')){if(holdRead){holdRead=false;await new Promise(resolve=>window.releaseRead=resolve);}return {task:{...tasks[0]}};}
                        return {project:{id:'p',lifecycle:'active'},membership:{role}};
                    };
                    const getCurrentUser=()=>({uid:actor}),storage={getItem:()=>null,setItem:()=>{}};
                    window.board=CrmProjectsBoard.createController({elements,presentationV2:true,getCurrentUser,apiFetchJson:api,onContextChanged:s=>window.presentation?.setContext(s)});
                    window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:true},panel:document.querySelector('[data-panel="projects"]'),storage,getCurrentUser,onDensity:(m,s)=>board.setDensity(m,s),createWorkspace:opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser})});
                    board.init();presentation.init();const selection={projects:[{id:'p',name:'Synthetic PR05',lifecycle:'active'}],selectedProjectId:'p'};presentation.setSelection(selection);board.setProjects(selection);
                }''', bindings)
                page.wait_for_function('board.getState().authorizationReady')
                page.wait_for_load_state('networkidle')
                row = page.locator('[data-task-id="t0"]').first
                title = row.locator('.crm-board-title-button')

                def touch_field(key):
                    if page.locator('#projects-board-detail').evaluate('e=>e.open'):page.locator('#btn-projects-board-close-detail').tap()
                    row.locator('[data-action="task-menu"]').tap()
                    page.locator(f'[data-edit-field="{key}"]').tap()
                # Title, selection and keyboard entry are separate actions.
                row.locator('[data-action="select-task"]').check()
                assert page.evaluate('board.getState().selectedTaskId') == ''
                title.click()
                assert page.locator('[data-detail-panel="details"]').evaluate('e=>!e.hidden')
                page.locator('#btn-projects-board-close-detail').click()
                row.focus()
                page.keyboard.press('F2')
                rename = row.locator('input[data-field-kind="title"]')
                rename.fill('Đổi tên công việc')
                if touch:
                    row.locator('[data-action="save-rename"]').tap()
                else:
                    page.keyboard.press('Enter')
                page.wait_for_function('calls.filter(c=>c.method==="PATCH").length===1')
                page.wait_for_selector('[data-task-id="t0"] .crm-board-title-button')
                assert title.text_content() == 'Đổi tên công việc'
                assert row.locator('[data-column-key="taskTitle"]').evaluate('e=>getComputedStyle(e).position') == ('static' if touch else 'sticky'), 'List flows naturally; Table retains sticky task identity'
                title.focus()
                page.keyboard.press('F2')
                rename.fill('Draft cancelled')
                page.keyboard.press('Escape')
                assert title.text_content() == 'Đổi tên công việc'
                # Bring a descriptor into the narrow viewport through actual table scrolling.
                status = row.locator('[data-action="pick-status"]')
                if touch:
                    touch_field('status')
                else:
                    status.focus(); page.keyboard.press('Enter')
                page.screenshot(path=str(out / f'status-{width}.png'), full_page=True)
                page.keyboard.press('ArrowDown')
                page.keyboard.press('Enter')
                page.wait_for_function('board.getState().tasks.get("t0").status==="in_progress"')
                assert page.evaluate('document.activeElement.dataset.action') == 'pick-status'
                if touch:
                    touch_field('ownerUid')
                else:
                    row.locator('[data-people-kind="ownerUid"]').click()
                page.locator('[data-people-uid="b"]').click()
                page.wait_for_function('board.getState().tasks.get("t0").ownerUid==="b"')
                assert page.evaluate('calls.filter(c=>c.body?.ownerUid==="b").length') == 1
                assert page.evaluate('calls.find(c=>c.body?.ownerUid==="b").body.assigneeUids') == ['former']
                assert row.locator('[data-people-kind="ownerUid"] .crm-board-owner-avatar').count() == 1
                people = row.locator('[data-people-kind="assigneeUids"]')
                if touch:
                    touch_field('assigneeUids')
                else:
                    people.focus(); page.keyboard.press('Enter')
                assert page.locator('[data-people-uid="b"]').is_disabled()
                page.screenshot(path=str(out / f'people-{width}.png'), full_page=True)
                page.locator('[data-people-uid="c"]').click()
                page.wait_for_function('board.getState().tasks.get("t0").assigneeUids.includes("c")')
                page.keyboard.press('Escape')
                assert page.evaluate('document.activeElement.dataset.peopleKind') == 'assigneeUids'
                # Date-only values remain identical across three browser timezones.
                dates = row.locator('[data-action="edit-dates"]')
                if touch:
                    touch_field('dates')
                else:
                    dates.focus(); page.keyboard.press('Enter')
                picker = page.locator('[data-row-editor="dates"]')
                if touch:
                    picker.locator('[name="startDate"]').tap()
                    page.locator('[data-datepick-day="2026-09-02"]').tap()
                    assert picker.is_visible()
                else:
                    picker.locator('[name="startDate"]').fill('2026-09-02')
                picker.locator('[name="dueDate"]').fill('2026-09-21')
                picker.locator('[data-preview-dates]').click()
                page.screenshot(path=str(out / f'dates-{width}.png'), full_page=True)
                picker.locator('[data-apply-dates]').click()
                page.wait_for_function('board.getState().tasks.get("t0").dueDate==="2026-09-21"')
                assert '2026-09-02' in dates.text_content()
                assert page.evaluate('calls.filter(c=>c.url.endsWith("schedule-apply")).length') == 1
                page.locator('#projects-board-scroll').evaluate('e=>{e.scrollLeft=480;e.dispatchEvent(new Event("scroll"));}')
                if touch:
                    assert page.locator('#projects-board-table').get_attribute('data-presentation')=='list'
                    assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+1')
                else:assert abs(row.locator('[data-column-key="taskTitle"]').bounding_box()['x'] - page.locator('#projects-board-scroll').bounding_box()['x']) < 2
                # Typed zero/empty and actual custom priority key through native controls.
                number = row.locator('input[data-column-id="number"]')
                if touch:
                    for value in ['0', '']:
                        touch_field('custom:number')
                        field = page.locator('[data-row-editor="field"]')
                        field.locator('input').fill(value)
                        field.locator('[data-save-field]').tap()
                        page.wait_for_selector('[data-row-editor="field"]', state='detached')
                else:
                    number.fill('0'); number.press('Tab')
                    number.fill(''); number.press('Tab')
                page.wait_for_function('board.getState().tasks.get("t0").values.number===null')
                if touch:
                    touch_field('custom:importance')
                    page.locator('[data-row-editor="field"] select').select_option('urgent')
                    page.locator('[data-save-field]').tap()
                else:
                    row.locator('select[data-column-id="importance"]').select_option('urgent')
                page.wait_for_function('board.getState().tasks.get("t0").values.importance==="urgent"')
                assert row.locator('select[data-column-id="choice"]').input_value() == 'removed'
                if touch and page.locator('#projects-board-detail').evaluate('e=>e.open'):page.locator('#btn-projects-board-close-detail').tap()
                # Retained editor during a rank change and distant scroll.
                page.locator('#projects-board-scroll').evaluate('e=>{e.scrollLeft=0;e.scrollTop=0;e.dispatchEvent(new Event("scroll"));}')
                row.focus(); page.keyboard.press('F2')
                rename.evaluate('e=>{window.retained=e;e.value="Retained draft";e.dispatchEvent(new Event("input",{bubbles:true}));e.setSelectionRange(2,7,"backward");}')
                page.evaluate('board.updateTask({...board.getState().tasks.get("t0"),rank:"7/2"})')
                page.locator('#projects-board-scroll').evaluate('e=>{e.scrollTop=2000;e.dispatchEvent(new Event("scroll"));}')
                assert page.evaluate('document.activeElement===retained&&retained.isConnected&&retained.selectionStart===2&&retained.selectionEnd===7')
                if touch:assert page.locator('#projects-board-rows [role="listitem"]').count()==50
                else:assert page.locator('#projects-board-rows [data-row-id]').count() < 50
                page.keyboard.press('Escape')
                page.locator('#projects-board-scroll').evaluate('e=>{e.scrollLeft=0;e.scrollTop=0;e.dispatchEvent(new Event("scroll"));}')
                page.evaluate('board.updateTask({...board.getState().tasks.get("t0"),rank:"0/1"})')
                if touch:
                    row.locator('[data-action="open-subtasks"]').tap()
                    for child in ['t1','t2']:
                        page.locator(f'[data-detail-child="{child}"]').tap()
                        assert page.evaluate('innerWidth')==390
                        assert page.evaluate('board.getState().selectedTaskId')==child
                    for parent in ['t1','t0']:
                        page.locator('[data-detail-parent]').tap()
                        assert page.evaluate('board.getState().selectedTaskId')==parent
                    page.locator('#btn-projects-board-close-detail').tap()
                    assert page.evaluate('calls.filter(c=>c.url.includes("/tasks?")).some(c=>JSON.parse(new URL(c.url,"https://fixture.invalid").searchParams.get("filters")).parentTaskId==="t1")')
                else:
                    row.locator('[data-action="toggle-task"]').click()
                    page.wait_for_selector('[data-task-id="t1"]')
                    page.locator('[data-task-id="t1"] [data-action="toggle-task"]').click()
                    page.wait_for_selector('[data-task-id="t2"]')
                    assert page.locator('[data-task-id="t2"]').get_attribute('data-depth') == '2'
                    assert page.locator('[data-task-id="t2"] .crm-board-expander').count() == 0
                menu = row.locator('[data-action="task-menu"]')
                if touch:
                    menu.tap()
                else:
                    menu.focus(); page.keyboard.press('Enter')
                page.locator('[data-move-task]').click()
                assert page.locator('[data-row-editor="move"]').is_visible()
                page.screenshot(path=str(out / f'editors-{width}.png'), full_page=True)
                page.keyboard.press('Escape')
                assert page.locator('.crm-row-editor').count() == 0
                assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth') <= 1
                assert page.evaluate('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size===document.querySelectorAll("[id]").length')
                # Independent remote-write reproductions use the real picker entry points.
                def activate(locator):
                    if touch:
                        locator.tap()
                    else:
                        locator.click()

                def open_field(key):
                    if touch and page.locator('#projects-board-detail').evaluate('e=>e.open'):page.locator('#btn-projects-board-close-detail').tap()
                    activate(row.locator('[data-action="task-menu"]'))
                    activate(page.locator(f'[data-edit-field="{key}"]'))

                def remote_people(custom, values):
                    page.evaluate("""({custom,values})=>{const task=tasks[0];task.revision++;
                        if(custom)task.values={...task.values,team:values};else task.assigneeUids=values;
                        task.ownerUid='a';board.updateTask({...task});}""", {'custom': custom, 'values': values})

                if args.conflict_case != 'dates':
                    for custom in [False, True]:
                        remote_people(custom, ['b'])
                        open_field('custom:team' if custom else 'assigneeUids')
                        remote_people(custom, ['b', 'c'])
                        before = page.evaluate('calls.filter(c=>c.method==="PATCH").length')
                        option = page.locator('[data-people-uid="b"]')
                        option.focus(); activate(option)
                        assert page.evaluate('calls.filter(c=>c.method==="PATCH").length') == before, 'remote collaborator must not be silently removed'
                        assert page.evaluate('document.activeElement.dataset.peopleUid') == 'b'
                        assert 'changed' in page.locator('[data-people-result]').text_content().lower()
                        activate(page.locator('[data-reload-people]'))
                        page.wait_for_function('document.querySelector("[data-people-uid=c]").getAttribute("aria-selected")==="true"')
                        activate(page.locator('[data-people-uid="b"]'))
                        page.wait_for_function('(n)=>calls.filter(c=>c.method==="PATCH").length===n', arg=before + 1)
                        assert page.evaluate('(custom)=>custom?tasks[0].values.team:tasks[0].assigneeUids', custom) == ['c']
                        remote_people(custom, ['c', 'former'])
                        activate(page.locator('[data-people-uid="c"]'))
                        assert page.evaluate('calls.filter(c=>c.method==="PATCH").length') == before + 1
                        activate(page.locator('[data-reload-people]'))
                        page.wait_for_function('document.querySelector("[data-people-uid=former]").getAttribute("aria-selected")==="true"')
                        activate(page.locator('[data-people-uid="c"]'))
                        page.wait_for_function('(n)=>calls.filter(c=>c.method==="PATCH").length===n', arg=before + 2)
                        assert page.evaluate('(custom)=>custom?tasks[0].values.team:tasks[0].assigneeUids', custom) == ['former']
                        assert page.evaluate('tasks[0].ownerUid') == 'a'
                        page.screenshot(path=str(out / f'remote-people-{custom}-{width}.png'), full_page=True)
                        page.keyboard.press('Escape')

                if args.conflict_case != 'people':
                    for stage in ['preview', 'apply']:
                        open_field('dates')
                        picker = page.locator('[data-row-editor="dates"]')
                        picker.locator('[name="dueDate"]').fill('2026-09-24')
                        if stage == 'apply':
                            activate(picker.locator('[data-preview-dates]'))
                            page.wait_for_function('!document.querySelector("[data-apply-dates]").disabled')
                        page.evaluate('tasks[0].revision++;tasks[0].dueDate="2026-09-25";board.updateTask({...tasks[0]})')
                        activate(picker.locator('[data-apply-dates]' if stage == 'apply' else '[data-preview-dates]'))
                        page.wait_for_function('document.querySelector("[data-date-result]").textContent.match(/changed|not confirmed/i)')
                        page.keyboard.press('Escape'); page.evaluate('board.refresh()')
                        open_field('dates')
                        assert picker.locator('[name="dueDate"]').input_value() == '2026-09-24'
                        assert picker.locator('[data-review-dates]').count() == 1, 'date draft needs recovery after conflict'
                        activate(picker.locator('[data-review-dates]'))
                        page.wait_for_function('document.querySelector("[data-date-result]").textContent.includes("2026-09-25")')
                        picker.locator('[name="dueDate"]').fill('2026-09-26')
                        count = page.evaluate('calls.filter(c=>c.method!=="GET").length')
                        activate(picker.locator('[data-rebase-dates]'))
                        assert page.evaluate('calls.filter(c=>c.method!=="GET").length') == count
                        assert picker.locator('[name="dueDate"]').input_value() == '2026-09-26'
                        assert picker.locator('[data-apply-dates]').is_disabled()
                        activate(picker.locator('[data-preview-dates]'))
                        page.wait_for_function('!document.querySelector("[data-apply-dates]").disabled')
                        assert page.evaluate('calls.filter(c=>c.url.endsWith("schedule-preview")).at(-1).body.expectedRevision===tasks[0].revision')
                        page.screenshot(path=str(out / f'recovered-{stage}-{width}.png'), full_page=True)
                        activate(picker.locator('[data-apply-dates]'))
                        page.wait_for_function('tasks[0].dueDate==="2026-09-26"&&!document.querySelector("[data-row-editor=dates]")')
                        open_field('dates')
                        picker.locator('[name="dueDate"]').fill('2026-09-29')
                        activate(picker.locator('[data-review-dates]'))
                        page.wait_for_function('!document.querySelector("[data-discard-dates]").hidden')
                        activate(picker.locator('[data-discard-dates]'))
                        assert picker.locator('[name="dueDate"]').input_value() == '2026-09-26'
                        assert picker.locator('[data-apply-dates]').is_disabled()
                        page.keyboard.press('Escape')
                # Recovery reads cannot revive controls after permission or project loss.
                for kind in ['people', 'dates']:
                    for loss in ['permission', 'project', 'actor']:
                        open_field('assigneeUids' if kind == 'people' else 'dates')
                        recovery = page.locator('.crm-people-popover' if kind == 'people' else '[data-row-editor="dates"]')
                        recovery.evaluate('e=>window.detachedRecovery=e')
                        before = page.evaluate('calls.filter(c=>c.method!=="GET").length')
                        page.evaluate('window.holdRead=true;window.releaseRead=null')
                        activate(recovery.locator('[data-reload-people]' if kind == 'people' else '[data-review-dates]'))
                        page.wait_for_function('typeof releaseRead==="function"')
                        if loss == 'permission':
                            page.evaluate('window.role="Viewer";board.refresh()')
                        elif loss == 'project':
                            page.evaluate('board.setProjects({projects:[{id:"q",lifecycle:"active"}],selectedProjectId:"q"})')
                        else:
                            page.evaluate('window.actor="other"')
                            if touch and page.locator('#projects-board-detail').evaluate('e=>e.open'):page.locator('#btn-projects-board-close-detail').tap()
                            activate(row.locator('[data-action="task-menu"]'))
                        page.evaluate('releaseRead()')
                        page.wait_for_function('!detachedRecovery.isConnected')
                        page.evaluate("""kind=>{
                            detachedRecovery.querySelector(kind==='people'?'[data-people-uid="c"]':'[data-rebase-dates]').click();
                            if(kind==='dates')detachedRecovery.querySelector('[data-preview-dates]').click();
                        }""", kind)
                        assert page.evaluate('calls.filter(c=>c.method!=="GET").length') == before
                        page.evaluate('window.role="Owner";window.actor="a";board.setProjects({projects:[{id:"p",lifecycle:"active"}],selectedProjectId:"p"});board.refresh()')
                        page.wait_for_function('board.getState().authorizationReady')
                        page.wait_for_selector('[data-task-id="t0"] [data-action="task-menu"]:not(:disabled)')
                results.append({'width': width, 'timezone': timezone, 'touch': touch, 'calls': page.evaluate('calls')})
                context.close()
        finally:
            browser.close()
    (out / 'report.json').write_text(json.dumps({'results': results, 'errors': errors, 'hashes': hashes, 'scope': 'Offline synthetic Chrome; no real backend, auth, persistence or production verification'}, ensure_ascii=False, indent=2), encoding='utf-8')
    assert not errors, errors
    print(f'PASS: {len(results)} Chrome row/editor workflows; {out}')


if __name__ == '__main__':
    main()
