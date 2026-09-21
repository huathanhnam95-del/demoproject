"""PR07 synthetic Chrome: native dialog and real board/discussion composition; no authentication."""
import argparse, hashlib, json, re, runpy
from pathlib import Path
from playwright.sync_api import sync_playwright

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parents[3];out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    hashes,results,errors={},{},[]
    def source(name):
        data=(root/name).read_bytes();hashes[name]=hashlib.sha256(data).hexdigest();return data.decode('utf-8')
    host=source('public/crm-admin.html')
    panel=runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']();panel.feed(host);markup=''.join(panel.parts)
    header=re.search(r'<header class="crm-header">.*?</header>',host,re.S).group()
    styles=re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"',host)
    bindings=dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)",source('public/crm-admin.js')))
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        try:
            for width in [390,700,980,1280,1600]:
                context=browser.new_context(viewport={'width':width,'height':900},has_touch=True)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',lambda route:route.abort())
                page.set_content('<!doctype html><html><body><div class="crm-admin">'+header+'<main id="crm-main" class="crm-content">'+markup+'</main></div></body></html>')
                for name in styles:page.add_style_tag(content=source('public/'+name.split('?')[0].lstrip('/')))
                page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
                for name in ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','presentation/detail-surface','board','date-picker','discussion','views','workspace','presentation/ui-preferences','presentation/shell','presentation/entry']:page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
                page.evaluate('CrmProjectsDatePicker.init()')
                page.evaluate('''bindings=>{
                    const elements=Object.fromEntries(Object.entries(bindings).map(([k,id])=>[k,document.getElementById(id)]));
                    window.actor='a';window.role='Owner';window.calls=[];window.fail=0;window.release=null;window.holdNext=false;window.holdRead=false;
                    const people=[{uid:'a',displayName:'Nguyễn Thị Huyền phụ trách phối hợp kiểm tra nội dung tiếng Việt rất dài'},{uid:'b',displayName:'Nguyễn Thị B'},{uid:'c',displayName:'Trần C'}];
                    const columns=[{id:'team',label:'Team',type:'people'},{id:'notes',label:'Notes',type:'text'},{id:'number',label:'Estimate',type:'number'},{id:'importance',label:'Priority',type:'priority'},{id:'choice',label:'Choice',type:'dropdown',options:[{key:'yes',label:'Yes'}]}];
                    window.tasks=Array.from({length:80},(_,i)=>({id:`t${i}`,title:`Công việc ${i} — Nguyễn Thị Huyền kiểm tra nội dung tiếng Việt và phối hợp với nhóm phụ trách <b>`,sectionId:'s',rank:`${i}/1`,revision:1,lifecycle:'active',activeChildCount:i===0?1:0,ownerUid:'a',assigneeUids:['b','former'],startDate:'2026-09-01',dueDate:'2026-09-20',values:{team:['b'],notes:'Original',number:0,importance:'high',choice:'removed'}}));
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
                        if(url.includes('/view?'))return {project:{id:'p',lifecycle:'active'},membership:{role},tasks,sections:[],columns:[],aggregates:{}};if(url.includes('/discussion'))return {messages:[],hasMore:false};
                        if(url.includes('member-directory'))return {people};
                        if(url.includes('/tasks?')){const parent=JSON.parse(new URL(url,'https://fixture.invalid').searchParams.get('filters')||'{}').parentTaskId;return {tasks:tasks.filter(t=>parent?t.parentTaskId===parent:!t.parentTaskId),columns,sections:[{id:'s',title:'Section',rank:'0/1'}],revision:{schemaRevision:1,structureRevision:1}};}
                        if(url.endsWith('/tasks/t0')){if(holdRead){holdRead=false;await new Promise(resolve=>window.releaseRead=resolve);}return {task:{...tasks[0]}};}
                        return {project:{id:'p',lifecycle:'active'},membership:{role}};
                    };
                    const getCurrentUser=()=>({uid:actor}),storage={getItem:()=>null,setItem:()=>{}};
                    window.discussion=CrmProjectsDiscussion.createController({elements,getCurrentUser,apiFetchJson:api});discussion.init();CrmProjectsDiscussion.setSelection=discussion.setSelection;
                    window.board=CrmProjectsBoard.createController({elements,presentationV2:true,getCurrentUser,apiFetchJson:api,onTaskSelection:t=>window.views?.setTask(t),onContextChanged:s=>window.presentation?.setContext(s)});
                    window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:true},panel:document.querySelector('[data-panel="projects"]'),storage,getCurrentUser,onDensity:(m,s)=>board.setDensity(m,s),createWorkspace:opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser})});
                    window.views=CrmProjectsViews.createController({board,getCurrentUser,apiFetchJson:api});views.init();views.setProject('p');board.init();presentation.init();const selection={projects:[{id:'p',name:'Synthetic PR07',lifecycle:'active'}],selectedProjectId:'p'};presentation.setSelection(selection);board.setProjects(selection);
                }''', bindings)
                page.wait_for_function('board.getState().authorizationReady')
                page.wait_for_load_state('networkidle')
                row=page.locator('#projects-board-rows [data-task-id="t0"]');title=row.locator('[data-action="open-detail"]')
                (title.tap() if width==390 else title.click());dialog=page.locator('#projects-board-detail')
                assert dialog.evaluate('e=>e.open')
                expected='modal' if width<1000 else 'drawer';assert dialog.get_attribute('data-detail-mode')==expected
                assert dialog.evaluate('e=>e.matches(":modal")')==(expected=='modal')
                if expected=='drawer':assert 440<=dialog.bounding_box()['width']<=500
                # Include the real sticky CRM header: a visible Close can still be occluded.
                page.evaluate('window.scrollTo(0,0)')
                close=page.locator('#btn-projects-board-close-detail')
                host_hit=close.evaluate('''e=>{
                    const r=e.getBoundingClientRect(),d=e.closest('dialog').getBoundingClientRect(),
                        h=document.querySelector('.crm-header').getBoundingClientRect(),
                        t=document.getElementById('projects-board-detail-title'),tr=t.getBoundingClientRect();
                    return {ownsHit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
                        top:d.top,headerTop:h.top,headerBottom:h.bottom,titleTop:tr.top,titleBottom:tr.bottom,
                        titleUnclipped:t.scrollWidth<=t.clientWidth&&t.scrollHeight<=t.clientHeight,
                        bottom:d.bottom,viewport:innerHeight};
                }''')
                page.screenshot(path=str(out/f'full-host-close-{width}.png'))
                (out/f'full-host-close-{width}.json').write_text(json.dumps(host_hit,indent=2))
                close.click(timeout=3000)  # Ordinary actionability/hit-testing; never force a click.
                assert host_hit['ownsHit'] and host_hit['titleUnclipped'],host_hit
                assert host_hit['titleTop']>=host_hit['top'] and host_hit['titleBottom']<=host_hit['bottom']<=host_hit['viewport']+1,host_hit
                if expected=='drawer':assert host_hit['headerTop']==0 and host_hit['top']>=host_hit['headerBottom']>0,host_hit
                assert not dialog.evaluate('e=>e.open')
                assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId')=='t0'
                title.click()
                assert page.locator('#projects-detail-tab-details').text_content()=='Overview'
                assert page.locator('[data-detail-tab="files"], [data-detail-tab="activity"]').count()==0
                assert page.locator('#projects-board-detail-body [data-field-kind="title"]').count()==1
                page.wait_for_selector('#projects-task-schedule', state='attached')
                # A genuine revision mismatch exercises the board's canonical PATCH/read/retry path.
                field=dialog.locator('.crm-board-field[data-column-id="notes"]')
                page.evaluate("tasks[0].revision++;tasks[0].values.notes='Authoritative remote value'")
                field.fill('Bản nháp cần giữ lại');field.press('Tab')
                review=dialog.locator('[data-remote-conflict-review="t0"]')
                review.wait_for(state='visible')
                assert page.locator('[data-remote-conflict-review]').count()==1
                assert page.evaluate("calls.filter(c=>c.method==='PATCH').length")==1
                prompts=[]
                def reject(prompt):
                    prompts.append(prompt.message);prompt.dismiss()
                page.once('dialog',reject);review.focus();page.keyboard.press('Enter')
                page.wait_for_function("!document.querySelector('[data-remote-conflict-review]').disabled")
                assert len(prompts)==1 and 'Authoritative remote value' in prompts[0]
                assert page.evaluate("calls.filter(c=>c.method==='PATCH').length")==1
                assert field.input_value()=='Bản nháp cần giữ lại'
                page.screenshot(path=str(out/f'conflict-{width}.png'))
                page.once('dialog',lambda prompt:prompt.accept());review.click()
                page.wait_for_function("calls.filter(c=>c.method==='PATCH').length===2 && !document.querySelector('[data-remote-conflict-review]')")
                assert page.evaluate("calls.filter(c=>c.method==='PATCH').map(c=>c.body.expectedRevision)")==[1,2]
                assert page.evaluate("tasks[0].values.notes")=='Bản nháp cần giữ lại'
                # Scroll a real owner control under Close, then use actual pointer/touch coordinates.
                close_hits=[]
                for pointer in ['mouse','touch']:
                    hit=dialog.evaluate("""d=>{
                        const owner=d.querySelector('[data-people-kind="ownerUid"]'),close=d.querySelector('#btn-projects-board-close-detail');
                        d.scrollTop=300;let c=close.getBoundingClientRect(),o=owner.getBoundingClientRect();
                        d.scrollTop+=o.top+o.height/2-(c.top+c.height/2);
                        c=close.getBoundingClientRect();o=owner.getBoundingClientRect();
                        const x=c.left+c.width/2,y=c.top+c.height/2;
                        return {x,y,scroll:d.scrollTop,ownerUnderClose:y>=o.top&&y<=o.bottom,closeOnTop:close.contains(document.elementFromPoint(x,y))};
                    }""")
                    assert hit['scroll']>0 and hit['ownerUnderClose'] and hit['closeOnTop'],hit
                    page.screenshot(path=str(out/f'scrolled-close-{pointer}-{width}.png'))
                    if pointer=='mouse':page.mouse.click(hit['x'],hit['y'])
                    else:page.touchscreen.tap(hit['x'],hit['y'])
                    assert not dialog.evaluate('e=>e.open')
                    assert page.evaluate('board.getState().selectedTaskId')==''
                    assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId')=='t0'
                    close_hits.append(hit);title.click()
                dialog.evaluate('e=>e.scrollTop=0')
                page.locator('#projects-detail-tab-updates').click();composer=page.locator('#projects-board-discussion-input');composer.fill('Bản nháp Nguyễn Thị Huyền với tiếng Việt rất dài')
                page.locator('#projects-board-discussion-file').set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic attachment'})
                page.evaluate('window.originalComposer=document.getElementById("projects-board-discussion-input");originalComposer.setSelectionRange(3,8)')
                for target in [1280,390,700,980,1280,width]:
                    page.set_viewport_size({'width':target,'height':900});page.wait_for_function('(w)=>document.getElementById("projects-board-detail").dataset.detailMode===(w<1000?"modal":"drawer")',arg=target)
                    assert dialog.evaluate('e=>e.open');assert composer.input_value().startswith('Bản nháp');assert page.evaluate('originalComposer===document.getElementById("projects-board-discussion-input")')
                    assert page.locator('#projects-detail-tab-updates').get_attribute('aria-selected')=='true'
                    assert composer.evaluate('e=>e.selectionStart===3 && e.selectionEnd===8')
                    assert page.locator('#projects-board-discussion-file').evaluate('e=>e.files[0]?.name')=='synthetic.txt'
                # Native modal Tab boundary; desktop remains free to focus the board.
                if expected=='modal':
                    page.evaluate('window.tabStops=[...document.querySelectorAll("#projects-board-detail button,#projects-board-detail input,#projects-board-detail select,#projects-board-detail textarea")].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length);tabStops.at(-1).focus()')
                    page.keyboard.press('Tab');assert page.evaluate('document.activeElement===tabStops[0]')
                    page.keyboard.press('Shift+Tab');assert page.evaluate('document.activeElement===tabStops.at(-1)')
                else:
                    title.focus();assert title.evaluate('e=>e===document.activeElement');composer.focus()
                    page.evaluate('const d=document.getElementById("projects-workspace-settings");d.hidden=false;d.showModal()')
                    page.keyboard.press('Escape');assert dialog.evaluate('e=>e.open')
                # Real browser pinch zoom (visual viewport), separate from layout-width tests.
                cdp=context.new_cdp_session(page);cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1.5})
                assert page.evaluate('visualViewport.scale')>1.4
                assert dialog.evaluate('e=>e.open');cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1})
                # Tab traversal and Escape close the surface, preserving the existing keyed composer draft.
                page.keyboard.press('Escape');assert not dialog.evaluate('e=>e.open')
                assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId')=='t0'
                title.click();page.locator('#projects-detail-tab-updates').click();assert composer.input_value().startswith('Bản nháp')
                page.locator('#projects-detail-tab-details').click()
                body=page.locator('#projects-board-detail-body');body.locator('[data-people-kind="ownerUid"]').click()
                assert dialog.locator('.crm-people-popover').count()==1
                search=dialog.locator('.crm-people-popover input[type="search"]');search.click();search.fill('Nguyễn')
                assert search.evaluate('e=>e===document.activeElement')
                assert search.evaluate('e=>{const r=e.getBoundingClientRect();return e===document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)}')
                page.screenshot(path=str(out/f'active-picker-{width}.png'))
                page.keyboard.press('Escape');assert dialog.evaluate('e=>e.open')
                body.locator('[data-action="edit-dates"]').click();dialog.locator('[name="dueDate"]').click();assert dialog.locator('.crm-datepick').count()==1
                page.keyboard.press('Escape');assert dialog.locator('[data-row-editor="dates"]').count()==1
                page.keyboard.press('Escape');assert dialog.evaluate('e=>e.open')
                assert dialog.evaluate('e=>e.scrollWidth-e.clientWidth')<=1, dialog.evaluate('e=>({scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollLeft:e.scrollLeft,rect:e.getBoundingClientRect().toJSON(),children:[...e.querySelectorAll("*")].filter(n=>n.getBoundingClientRect().right>e.getBoundingClientRect().right).map(n=>[n.className,n.getBoundingClientRect().toJSON()]).slice(0,8)})')
                page.screenshot(path=str(out/f'details-{width}.png'))
                page.locator('#btn-projects-board-close-detail').click()
                # Force virtual remount before close.
                title.click();page.evaluate('const s=document.getElementById("projects-board-scroll");s.scrollTop=2400;s.dispatchEvent(new Event("scroll"))')
                page.locator('#btn-projects-board-close-detail').click();assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId')=='t0'
                title.click();page.evaluate('board.invalidateAccess("p")');assert not dialog.evaluate('e=>e.open');assert not body.text_content().strip()
                assert not page.locator('#projects-board-detail-title').text_content()
                assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=1
                assert page.evaluate('(()=>{const ids=[...document.querySelectorAll("[id]")].map(e=>e.id);return ids.length===new Set(ids).size})()')
                results[str(width)]={'nativeMode':expected,'transitions':6,'draft':True,'pickers':True,'focus':True,'invalidation':True,'attachmentSelectionRetained':True,'pinchZoom':1.5,'touch':True,'canonicalConflictRecovery':True,'scrolledClose':close_hits,'actualViewsController':True}
                context.close()
        finally:browser.close()
    (out/'report.json').write_text(json.dumps({'results':results,'errors':errors,'sourceHashes':hashes},indent=2),encoding='utf-8')
    assert not errors,errors
    print(f'PASS: {len(results)} PR07 Chrome workflows')
if __name__=='__main__':main()
