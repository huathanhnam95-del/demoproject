"""PR06 synthetic Chrome: canonical create and batch controller, offline fixtures only."""
import argparse
import hashlib
import json
import re
import runpy
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright


def remediation_workflows(browser, out, source, markup, bindings):
    results = []
    for width in [1600, 390]:
        for case in ['move', 'move-parent-first', 'move-child-first', 'move-partial', 'move-actor', 'move-project', 'move-role', 'legacy', 'legacy-click', 'draft', 'draft-nested', 'draft-recovery', 'draft-project']:
            context = browser.new_context(viewport={'width': width, 'height': 900}, has_touch=width == 390)
            page = context.new_page()
            page.route('**/*', lambda route: route.abort())
            page.set_content('<!doctype html><html><body class="crm-admin">' + markup + '</body></html>')
            for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
                page.add_style_tag(content=source('public/' + name))
            page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
            for name in ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'workspace', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']:
                page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
            page.evaluate('''({bindings,v2})=>{
                window.calls=[];window.hold=false;window.unconfirmed=false;window.receipts=new Map();window.actor='a';window.role='Owner';window.denyTask='';
                let seq=0,structure=1;
                const sections=[{id:'s',title:'Nguồn',rank:'0/1'},{id:'z',title:'Đích',rank:'1/1'}];
                window.rows=[{id:'t',title:'Parent',sectionId:'s',effectiveSectionId:'s',revision:1,rank:'0/1',activeChildCount:1},
                    {id:'child',title:'Child',parentTaskId:'t',effectiveSectionId:'s',ancestorIds:['t'],pathIds:['child','t'],revision:1,rank:'0/1',activeChildCount:1},
                    {id:'grand',title:'Grandchild',parentTaskId:'child',effectiveSectionId:'s',ancestorIds:['t','child'],pathIds:['grand','child','t'],revision:1,rank:'0/1'}];
                const api=async(url,opts)=>{
                    if(!opts){if(url.includes('member-directory'))return {people:[]};if(url.includes('/tasks?'))return {tasks:url.includes('/projects/q/')?[]:structuredClone(rows),sections,columns:[],revision:{structureRevision:structure,schemaRevision:1}};return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};}
                    const body=JSON.parse(opts.body);calls.push({url,body});if(hold){hold=false;await new Promise(r=>window.release=r);}
                    if(denyTask && url.endsWith(`/tasks/${denyTask}/move`))throw Object.assign(Error('Denied'),{status:403});
                    let result=receipts.get(body.operationId);
                    if(!result){
                        if(url.endsWith('/move')){const t=rows.find(t=>url.includes(`/tasks/${t.id}/`));Object.assign(t,{parentTaskId:null,sectionId:body.sectionId,revision:t.revision+1});const {effectiveSectionId,ancestorIds,pathIds,activeChildCount,...persisted}=t;result={task:persisted,structureRevision:++structure};}
                        else if(url.endsWith('/tasks')){const task={...body,id:`created${++seq}`,revision:1,rank:`${seq}/1`,effectiveSectionId:body.sectionId};rows.push(task);result={task,structureRevision:++structure};}
                        else throw Error('Unexpected '+url);
                        receipts.set(body.operationId,result);
                    }
                    return unconfirmed?{ok:true}:structuredClone(result);
                };
                const getCurrentUser=()=>({uid:actor}),storage={getItem:()=>null,setItem:()=>{}};
                window.board=CrmProjectsBoard.createController({elements:Object.fromEntries(Object.entries(bindings).map(([k,id])=>[k,document.getElementById(id)])),presentationV2:v2,getCurrentUser,apiFetchJson:api,onContextChanged:s=>window.presentation?.setContext(s)});
                window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:v2},panel:document.querySelector('[data-panel="projects"]'),storage,getCurrentUser,onDensity:(m,s)=>board.setDensity(m,s),createWorkspace:opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser})});
                board.init();presentation.init();const selection={projects:[{id:'p',name:'Remediation',lifecycle:'active'}],selectedProjectId:'p'};presentation.setSelection(selection);board.setProjects(selection);
            }''', {'bindings': bindings, 'v2': not case.startswith('legacy')})
            page.wait_for_function('board.getState().authorizationReady')
            page.wait_for_load_state('networkidle')
            def activate(locator):
                if width == 390 and locator.get_attribute('data-action') == 'add-subtask' and not locator.is_visible():
                    locator.locator('..').locator('[data-action="task-menu"]').tap()
                    page.locator('[data-add-child]').tap()
                elif width == 390:
                    locator.tap()
                else:
                    locator.click()
            try:
                if case == 'move':
                    page.evaluate("board.setSelectedTaskIds(['t'])")
                    page.locator('#projects-batch-section').select_option('z')
                    page.wait_for_function('document.querySelector("[data-batch-result]")?.textContent.includes("1 saved")')
                    assert page.evaluate("['t','child','grand'].map(id=>board.getState().tasks.get(id).effectiveSectionId)") == ['z'] * 3
                    activate(page.locator('[data-task-id="t"] [data-action="add-subtask"]'))
                    assert page.locator('[data-quick-create] select').input_value() == 'z'
                    page.locator('[data-quick-create] input').fill('Sau khi chuyển')
                    activate(page.locator('[data-quick-create] [type="submit"]'))
                    page.wait_for_function('calls.length===2')
                    assert page.evaluate('calls[1].body.sectionId') == 'z'
                elif case.startswith('move-'):
                    scoped=case in ['move-actor', 'move-project', 'move-role']
                    order=['child','t'] if case=='move-child-first' else ['t','child','grand'] if case=='move-partial' else ['t','child']
                    page.evaluate('({order,scoped,partial})=>{board.setSelectedTaskIds(order);hold=scoped;denyTask=partial?"child":"";}', {'order':order,'scoped':scoped,'partial':case=='move-partial'})
                    page.locator('#projects-batch-section').select_option('z')
                    if scoped:
                        page.wait_for_function('calls.length===1 && typeof window.release==="function"')
                        if case=='move-actor': page.evaluate("actor='b'")
                        elif case=='move-project': page.evaluate("board.setProjects({projects:[{id:'q',lifecycle:'active'}],selectedProjectId:'q'})")
                        else: page.evaluate("async()=>{role='Viewer';await board.refresh();}")
                        page.evaluate('()=>new Promise(done=>{release();requestAnimationFrame(()=>requestAnimationFrame(done));})')
                        assert page.evaluate('calls.length')==1
                        assert page.evaluate('board.getState().tasks.get("child")?.effectiveSectionId')!='z'
                        assert '1 saved' not in (page.locator('[data-batch-result]').text_content() if page.locator('[data-batch-result]').count() else '')
                    else:
                        page.wait_for_function('document.querySelector("[data-batch-result]")?.textContent.includes("saved")')
                        assert page.evaluate('calls.map(c=>c.body.expectedStructureRevision)')==[1,2]
                        assert page.evaluate('board.getState().tasks.get("grand").effectiveSectionId')=='z'
                        if case=='move-partial':
                            assert page.evaluate('board.getState().selectedTaskIds')==['child','grand']
                            assert page.evaluate('board.getState().tasks.get("t").activeChildCount')==1
                            assert page.locator('[data-batch-result]').inner_text().startswith('1 saved')
                            assert '1 failed' in page.locator('[data-batch-result]').inner_text()
                        else:
                            assert page.evaluate('board.getState().tasks.get("grand").ancestorIds')==['child']
                            assert page.evaluate('board.getState().tasks.get("t").activeChildCount')==0
                            assert page.locator('[data-batch-result]').inner_text().startswith('2 saved')
                elif case.startswith('legacy'):
                    page.evaluate('unconfirmed=true')
                    trigger=page.locator('#btn-projects-board-add-task')
                    if width == 1600 and case == 'legacy':
                        trigger.focus(); trigger.press('Enter')
                    else:
                        activate(trigger)
                    page.wait_for_function('calls.length===1 && !Array.from(board.getState().tasks.values()).some(t=>t.isOptimistic)')
                    assert page.locator('[data-retry-creation]').count() == 1, 'legacy recovery is reachable'
                    activate(trigger)
                    assert page.evaluate('calls.length') == 1
                    page.evaluate('unconfirmed=false')
                    retry=page.locator('[data-retry-creation]')
                    if width == 1600 and case == 'legacy':
                        retry.focus(); retry.press('Enter')
                    else:
                        activate(retry)
                    page.wait_for_function('calls.length===2 && !document.querySelector("[data-retry-creation]")')
                    assert page.evaluate('JSON.stringify(calls[0].body)===JSON.stringify(calls[1].body)')
                    assert page.evaluate('rows.filter(t=>t.id.startsWith("created")).length') == 1
                else:
                    page.evaluate("()=>{hold=true;window.parentPromise=board.createTask(null,'s',{initialTitle:'Parent mới',intentId:'parent-op'}).then(t=>window.parentId=t?.id);}")
                    page.wait_for_selector('[data-task-id^="opt-task-"]')
                    if case=='draft-nested':
                        page.evaluate("()=>{const temp=Array.from(board.getState().tasks.values()).find(t=>t.isOptimistic);window.childPromise=board.createTask(temp.id,null,{initialTitle:'Child mới'}).then(t=>window.childId=t.id);}")
                        page.wait_for_function('Array.from(board.getState().tasks.values()).filter(t=>t.isOptimistic).length===2')
                    activate(page.locator('[data-task-id^="opt-task-"] [data-action="add-subtask"]').last)
                    title=page.locator('[data-quick-create] input')
                    title.fill('Bản nháp được giữ lại')
                    if case=='draft-project':
                        page.evaluate("window.oldForm=document.querySelector('[data-quick-create]');board.setProjects({projects:[{id:'q',lifecycle:'active'}],selectedProjectId:'q'});release()")
                        page.wait_for_function('board.getState().authorizationReady')
                        page.evaluate("oldForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
                        assert page.evaluate('calls.length')==1
                        assert page.locator('[data-quick-create]').count()==0
                        assert page.locator('[data-task-id^="created"]').count()==0
                        results.append({'case':case,'width':width,'passed':True})
                        page.screenshot(path=str(out/f'remediation-{case}-{width}.png'),full_page=True)
                        context.close()
                        continue
                    if case=='draft-recovery': page.evaluate('unconfirmed=true')
                    page.evaluate('release()')
                    if case=='draft-recovery':
                        page.wait_for_function('!Array.from(board.getState().tasks.values()).some(t=>t.isOptimistic)')
                        assert title.input_value()=='Bản nháp được giữ lại'
                        page.evaluate("()=>{unconfirmed=false;board.createTask(null,'s',{initialTitle:'Parent mới',intentId:'parent-op',keepComposerFocus:true}).then(t=>window.parentId=t.id);}")
                    page.wait_for_function('window.parentId')
                    if case=='draft-nested': page.wait_for_function('window.childId')
                    assert title.evaluate('e=>document.activeElement===e')
                    activate(page.locator('[data-cancel-create]'))
                    parent_id='created2' if case=='draft-nested' else 'created1'
                    activate(page.locator(f'[data-task-id="{parent_id}"] [data-action="add-subtask"]'))
                    assert title.input_value() == 'Bản nháp được giữ lại'
                    before=page.evaluate('calls.length')
                    activate(page.locator('[data-quick-create] [type="submit"]'))
                    page.wait_for_function('before=>calls.length===before+1',arg=before)
                    assert page.evaluate('calls.at(-1).body.parentTaskId') == parent_id
                    assert page.evaluate('calls.at(-1).body.sectionId') == 's'
                results.append({'case': case, 'width': width, 'passed': True})
            except Exception:
                results.append({'case': case, 'width': width, 'passed': False, 'error': traceback.format_exc()})
            (out/'remediation-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
            page.screenshot(path=str(out/f'remediation-{case}-{width}.png'), full_page=True)
            context.close()
    (out/'remediation-report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    assert all(row['passed'] for row in results), results
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--remediation-only', action='store_true')
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
            remediation = remediation_workflows(browser, out, source, markup, bindings)
            for width, timezone, touch in ([] if args.remediation_only else [(1600, 'Asia/Ho_Chi_Minh', False), (390, 'Asia/Ho_Chi_Minh', True)]):
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
                    window.actor='a';window.calls=[];window.fail=0;window.malformed=false;window.holdNext=false;window.release=null;
                    const sections=[{id:'s',title:'Nhóm công việc tiếng Việt có dấu rất dài',rank:'0/1'},{id:'z',title:'Đích đến',rank:'1/1'}];
                    window.tasks=[{id:'t',title:'Công việc cha có nhãn tiếng Việt rất dài',sectionId:'s',rank:'0/1',revision:1,status:'not_started',activeChildCount:0},{id:'u',title:'Công việc thứ hai',sectionId:'s',rank:'1/1',revision:1,status:'not_started'}];
                    let structure=1,seq=0;const receipts=new Map();
                    const api=async(url,opts)=>{
                        if(!opts){if(url.includes('member-directory'))return {people:[]};if(url.includes('/tasks?'))return {tasks:tasks.slice(),sections,columns:[],revision:{structureRevision:structure,schemaRevision:1}};return {project:{id:'p',lifecycle:'active'},membership:{role:'Owner'}};}
                        const body=JSON.parse(opts.body);calls.push({url,body});if(holdNext){holdNext=false;await new Promise(r=>window.release=r);}
                        if(fail)throw Object.assign(Error('Synthetic denial'),{status:fail});if(malformed)return {ok:true};if(receipts.has(body.operationId))return receipts.get(body.operationId);
                        let result;
                        if(url.endsWith('/tasks')){const task={...body,id:`new${++seq}`,rank:`${seq+2}/1`,revision:1,effectiveSectionId:body.sectionId};tasks.push(task);result={task,structureRevision:++structure};}
                        else if(url.endsWith('/sections')){const section={id:`sec${++seq}`,title:body.title,rank:'4/1',revision:1};sections.push(section);result={section,structureRevision:++structure};}
                        else if(url.endsWith('/bulk')){const change=body.changes[0];if(change.taskId==='u')throw Object.assign(Error('Remote conflict'),{status:409});const task=tasks.find(t=>t.id===change.taskId);Object.assign(task,change.patch,{revision:task.revision+1});result={updated:[{taskId:task.id,revision:task.revision}],count:1};}
                        else throw Error(`Unexpected write ${url}`);
                        receipts.set(body.operationId,result);return result;
                    };
                    const getCurrentUser=()=>({uid:actor}),storage={getItem:()=>null,setItem:()=>{}};
                    window.board=CrmProjectsBoard.createController({elements,presentationV2:true,getCurrentUser,apiFetchJson:api,onContextChanged:s=>window.presentation?.setContext(s)});
                    window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:true},panel:document.querySelector('[data-panel="projects"]'),storage,getCurrentUser,onDensity:(m,s)=>board.setDensity(m,s),createWorkspace:opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser})});
                    board.init();presentation.init();const selection={projects:[{id:'p',name:'Synthetic PR06',lifecycle:'active'}],selectedProjectId:'p'};presentation.setSelection(selection);board.setProjects(selection);
                }''', bindings)
                page.wait_for_function('board.getState().authorizationReady')
                page.wait_for_load_state('networkidle')
                page.locator('#btn-projects-board-add-task').click()
                form=page.locator('[data-quick-create]')
                title=form.locator('input')
                title.fill('  Nguyễn Thị Ánh — Công việc có dấu rất dài <b>  ')
                page.evaluate('holdNext=true')
                if touch:
                    form.locator('[type="submit"]').tap()
                else:
                    title.press('Enter')
                page.wait_for_function('calls.length===1')
                page.evaluate("document.querySelector('[data-quick-create]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
                assert page.evaluate('calls.length')==1
                assert page.locator('.is-optimistic[data-task-id]').count()==1
                page.evaluate('release()')
                page.wait_for_function('document.querySelector("[data-quick-create] input").value===""')
                assert title.evaluate('e=>document.activeElement===e')
                assert page.evaluate('calls[0].body.title')=='Nguyễn Thị Ánh — Công việc có dấu rất dài <b>'
                assert page.locator('[data-task-id="new1"] .crm-board-title-button b').count()==0
                # Recover a malformed acknowledgement using an identical operation/body.
                title.fill('Không mất bản nháp khi kết nối bị gián đoạn')
                page.evaluate('malformed=true')
                form.locator('[type="submit"]').click()
                page.wait_for_function('calls.length===2')
                page.wait_for_function('document.querySelector("[data-quick-create]").textContent.includes("unconfirmed")')
                assert title.input_value()=='Không mất bản nháp khi kết nối bị gián đoạn'
                page.evaluate('malformed=false')
                form.locator('[type="submit"]').click()
                page.wait_for_function('calls.length===3 && document.querySelector("[data-quick-create] input").value===""')
                assert page.evaluate('JSON.stringify(calls[1].body)===JSON.stringify(calls[2].body)')
                title.fill('Bản nháp bị từ chối')
                page.evaluate('fail=403')
                form.locator('[type="submit"]').click()
                page.wait_for_function('document.querySelector("[data-quick-create]").textContent.includes("failed")')
                assert title.input_value()=='Bản nháp bị từ chối'
                page.evaluate('fail=0')
                form.locator('[data-cancel-create]').click()
                # Menu entry creates a nested child through the same composer.
                row=page.locator('[data-task-id="t"]').first
                row.locator('[data-action="task-menu"]').click()
                page.locator('[data-add-child]').click()
                form=page.locator('[data-quick-create]')
                form.locator('input').fill('Công việc con')
                form.locator('[type="submit"]').click()
                page.wait_for_function('calls.at(-1).body.parentTaskId==="t" && document.querySelector("[data-quick-create] input").value===""')
                form.locator('[data-cancel-create]').click()
                # A temporary row deliberately focused during saving keeps focus on its canonical identity.
                page.locator('#btn-projects-board-add-task').click()
                form=page.locator('[data-quick-create]')
                form.locator('input').fill('Giữ tiêu điểm khi lưu')
                page.evaluate('holdNext=true')
                form.locator('[type="submit"]').click()
                page.wait_for_selector('[data-task-id^="opt-task-"]')
                page.locator('[data-task-id^="opt-task-"]').focus()
                page.evaluate('release()')
                page.wait_for_function('document.activeElement.closest("[data-task-id]")?.dataset.taskId==="new4"')
                form.locator('[data-cancel-create]').click()
                page.locator('#btn-projects-board-add-section').click()
                section=page.locator('#projects-board-section-form')
                section.locator('input').fill('Nhóm việc mới với nhãn tiếng Việt dài')
                page.evaluate('holdNext=true')
                section.locator('[type="submit"]').click()
                page.wait_for_function('calls.at(-1).url.endsWith("/sections")')
                before_section=page.evaluate('calls.length')
                page.evaluate('document.getElementById("projects-board-section-form").requestSubmit()')
                assert page.evaluate('calls.length')==before_section
                page.evaluate('release()')
                section.wait_for(state='hidden')
                assert page.evaluate('calls.at(-1).body.title')=='Nhóm việc mới với nhãn tiếng Việt dài'
                # Snapshot selection, report per-item conflict and retain only that task.
                page.locator('[data-task-id="t"] [data-action="select-task"]').check()
                page.locator('[data-task-id="u"] [data-action="select-task"]').check()
                page.locator('#projects-batch-status').select_option('done')
                page.wait_for_function('document.querySelector("[data-batch-result]")?.textContent.includes("1 conflicts")')
                assert page.evaluate('JSON.stringify(board.getState().selectedTaskIds)')=='["u"]'
                assert page.locator('[data-batch-result]').inner_text().startswith('1 saved')
                assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=1
                if touch:
                    assert page.locator('#projects-batch-dock').evaluate('e=>getComputedStyle(e).position')=='sticky'
                page.screenshot(path=str(out/f'quick-create-{width}.png'),full_page=True)
                results.append({'width':width,'touch':touch,'requests':page.evaluate('calls'),'passed':True})
                context.close()
        finally:
            browser.close()
    assert not errors, errors
    (out/'report.json').write_text(json.dumps({'results':results,'remediation':remediation,'sourceHashes':hashes,'errors':errors,'scope':'Offline synthetic Chrome; no authentication or production calls'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'PASS: {len(results)} original and {len(remediation)} remediation PR06 Chrome workflows')

if __name__=='__main__':
    main()
