"""PR10 Chrome: container List/Table, keyboard, native modal and accessibility-tree evidence; synthetic APIs only."""
import argparse, hashlib, json, re, runpy
from pathlib import Path
from playwright.sync_api import sync_playwright

def mount(page,source,markup,bindings,hold_initial_view=False):
    page.set_content('<!doctype html><html><body class="crm-admin">'+markup+'</body></html>')
    for name in ['design-tokens.css','crm-admin.css','css/crm-projects.css','css/crm-projects-v2.css']:page.add_style_tag(content=source('public/'+name))
    page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
    for name in ['presentation/column-model','presentation/table-layout','presentation/field-feedback','state','presentation/detail-surface','board','date-picker','discussion','views','workspace','presentation/ui-preferences','presentation/shell','presentation/entry']:page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
    page.evaluate('CrmProjectsDatePicker.init()')
    if hold_initial_view:page.evaluate('()=>{window.initialViewGate=new Promise(resolve=>window.releaseInitialView=resolve)}')
    page.evaluate('''bindings=>{
        const elements=Object.fromEntries(Object.entries(bindings).map(([k,id])=>[k,document.getElementById(id)]));
        window.actor='a';window.role='Owner';window.calls=[];window.fail=0;window.release=null;window.holdNext=false;window.holdRead=false;window.childPageSize=50;window.failChild=0;window.holdChild=false;window.rejectChild=false;
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
            if(url.includes('/views?')&&window.initialViewGate)await window.initialViewGate;if(url.includes('/views?'))return {project:{id:'p',lifecycle:'active'},membership:{role},tasks,matchingTaskCount:tasks.length,sections:[],columns:[],aggregates:{}};if(url.includes('/discussion'))return {messages:[],hasMore:false};
            if(url.includes('member-directory'))return {people};
            if(url.startsWith('/api/projects/other/tasks?'))return {tasks:[],sections:[],columns:[]};
            if(url.includes('/tasks?')){const params=new URL(url,'https://fixture.invalid').searchParams,filters=JSON.parse(params.get('filters')||'{}'),parent=filters.parentTaskId;
                const found=tasks.filter(t=>(parent?t.parentTaskId===parent:!t.parentTaskId)&&(!filters.search||t.title.includes(filters.search))).map(t=>({...t}));
                if(parent&&holdChild){holdChild=false;await new Promise(resolve=>window.releaseChild=resolve);if(rejectChild)throw Object.assign(Error('Old child denied'),{status:403});}
                if(parent&&failChild)throw Object.assign(Error('Child page unavailable'),{status:failChild});
                const offset=Number(params.get('cursor')||0),size=parent?childPageSize:found.length;
                return {matchingTaskCount:tasks.length,tasks:found.slice(offset,offset+size),nextCursor:offset+size<found.length?String(offset+size):null,columns,sections:[{id:'s',title:'Section',rank:'0/1'}],revision:{schemaRevision:1,structureRevision:1}};}

            if(url.endsWith('/tasks/t0')){if(holdRead){holdRead=false;await new Promise(resolve=>window.releaseRead=resolve);}return {task:{...tasks[0]}};}
            if(url.includes('/tasks/'))return {task:{...tasks.find(t=>t.id===url.split('/').pop())}};
            return {project:{id:url.split('/').pop(),lifecycle:'active'},membership:{role}};
        };
        const getCurrentUser=()=>({uid:actor}),storage={getItem:()=>null,setItem:()=>{}};
        window.discussion=CrmProjectsDiscussion.createController({elements,getCurrentUser,apiFetchJson:api});discussion.init();CrmProjectsDiscussion.setSelection=discussion.setSelection;
        window.board=CrmProjectsBoard.createController({elements,presentationV2:true,getCurrentUser,apiFetchJson:api,onTaskSelection:t=>window.views?.setTask(t),onContextChanged:s=>window.presentation?.setContext(s)});
        window.presentation=CrmProjectsPresentationV2.createController({config:{projectsV2:true},panel:document.querySelector('[data-panel="projects"]'),storage,getCurrentUser,onDensity:(m,s)=>board.setDensity(m,s),createWorkspace:opts=>CrmProjectsWorkspace.createController({...opts,getCurrentUser})});
        window.views=CrmProjectsViews.createController({board,getCurrentUser,apiFetchJson:api});views.init();views.setProject('p');board.init();presentation.init();const selection={projects:[{id:'p',name:'Synthetic PR07',lifecycle:'active'}],selectedProjectId:'p'};presentation.setSelection(selection);board.setProjects(selection);
    }''', bindings)
    page.wait_for_function('board.getState().authorizationReady')
    page.wait_for_load_state('networkidle')


def assert_predecessor_name(page,out,label):
    cdp=page.context.new_cdp_session(page)
    tree=cdp.send('DOM.getDocument')
    node=cdp.send('DOM.querySelector',{'nodeId':tree['root']['nodeId'],'selector':'#projects-task-predecessor-picker'})
    ax=cdp.send('Accessibility.getPartialAXTree',{'nodeId':node['nodeId'],'fetchRelatives':False})
    (out/f'ax-predecessor-{label}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
    control=next(n for n in ax['nodes'] if n.get('role',{}).get('value')=='combobox')
    assert control['name']['value']=='Choose predecessor task',control
    return {'name':control['name']['value'],'disabled':page.locator('#projects-task-predecessor-picker').is_disabled()}

def assert_disclosure_keys(page,out,label):
    dialog=page.locator('#projects-board-detail');summary=dialog.get_by_text('Manual task ID entry',exact=True)
    textarea=dialog.locator('#projects-task-predecessors');save=dialog.get_by_role('button',name='Save dependencies',exact=True)
    page.wait_for_function('!document.querySelector("#projects-task-predecessors").disabled')
    assert not summary.locator('..').evaluate('e=>e.open')
    summary.focus();page.keyboard.press('Tab');assert save.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Shift+Tab');assert summary.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Enter');assert summary.locator('..').evaluate('e=>e.open')
    page.keyboard.press('Tab');assert textarea.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Tab');assert save.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Shift+Tab');assert textarea.evaluate('e=>e===document.activeElement')
    page.keyboard.press('Shift+Tab');assert summary.evaluate('e=>e===document.activeElement')
    page.screenshot(path=str(out/f'disclosure-{label}.png'))
    ax=page.context.new_cdp_session(page).send('Accessibility.getFullAXTree')
    (out/f'ax-disclosure-{label}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
    page.keyboard.press('Enter');page.keyboard.press('Tab');assert save.evaluate('e=>e===document.activeElement')
    if dialog.evaluate('e=>e.matches(":modal")'):
        page.keyboard.press('Tab');assert dialog.get_by_role('button',name='Close task details').evaluate('e=>e===document.activeElement')
        page.keyboard.press('Shift+Tab');assert save.evaluate('e=>e===document.activeElement')
    else:
        page.keyboard.press('Tab');assert not dialog.evaluate('e=>e.contains(document.activeElement)')
    return {'closedForwardReverse':True,'openForwardReverse':True,'boundaries':True}


def assert_mobile_hierarchy(page,out,keyboard=False):
    assert page.evaluate('innerWidth')==390
    row=page.locator('#projects-board-rows [data-task-id="t0"]');dialog=page.locator('#projects-board-detail')
    if keyboard:row.focus();page.keyboard.press('ArrowRight')
    else:row.locator('[data-action="open-subtasks"]').tap()
    for child in ['t1','t2']:
        button=dialog.locator(f'[data-detail-child="{child}"]');button.wait_for(state='visible')
        assert button.get_attribute('aria-label').startswith('Open subtask: Công việc')
        assert button.bounding_box()['height']>=44
        if keyboard:
            button.focus();page.keyboard.press('Tab');page.keyboard.press('Shift+Tab');assert button.evaluate('e=>e===document.activeElement');page.keyboard.press('Enter')
        else:button.tap()
        page.wait_for_function('(id)=>board.getState().selectedTaskId===id',arg=child)
        assert page.evaluate('innerWidth')==390
    page.screenshot(path=str(out/f'children-deep-390-{keyboard}.png'))
    for parent,child in [('t1','t2'),('t0','t1')]:
        back=dialog.get_by_role('button',name=re.compile('^Back to parent:'))
        if keyboard:back.focus();page.keyboard.press('Enter')
        else:back.tap()
        assert page.evaluate('board.getState().selectedTaskId')==parent
        assert dialog.locator(f'[data-detail-child="{child}"]').evaluate('e=>e===document.activeElement')
    ax=page.context.new_cdp_session(page).send('Accessibility.getFullAXTree')
    (out/f'ax-children-390-{keyboard}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
    names=[n.get('name',{}).get('value','') for n in ax['nodes'] if not n.get('ignored')]
    assert any(n.startswith('Open subtask: Công việc 1') for n in names)
    page.screenshot(path=str(out/f'children-parent-390-{keyboard}.png'))
    if keyboard:page.keyboard.press('Escape')
    else:dialog.get_by_role('button',name='Close task details').tap()
    assert not dialog.evaluate('e=>e.open')
    assert page.evaluate('document.activeElement.closest("#projects-board-rows [data-task-id]")?.dataset.taskId')=='t0'
    branches=page.evaluate('calls.filter(c=>c.url.includes("/tasks?")).map(c=>({parent:JSON.parse(new URL(c.url,"https://fixture.invalid").searchParams.get("filters")).parentTaskId,url:c.url}))')
    assert {'t0','t1'} <= {c['parent'] for c in branches}
    return {'constantWidth':390,'keyboard':keyboard,'branches':branches,'deepBackClose':True}

def assert_descendant_close(page,out,label,kind='pointer',backs=0,change='remount'):
    assert page.evaluate('innerWidth')==390
    opener=page.locator('#projects-board-rows [data-task-id="t0"] [data-action="open-subtasks"]')
    opener.evaluate('e=>window.originalOpener=e')
    def activate(control):
        if kind=='touch':control.tap()
        elif kind in ['Escape','keyboard-close']:control.focus();page.keyboard.press('Enter')
        else:control.click()
    if change=='virtual':
        page.evaluate('board.updateTask({...tasks[0],rank:"1000/1",revision:2})')
        assert page.locator('#projects-board-rows [data-task-id="t0"]').count()==0
        page.evaluate('document.activeElement.blur();board.selectTask(board.getState().tasks.get("t0"))')
    else:activate(opener)
    for child in ['t1','t2']:
        button=page.locator(f'[data-detail-child="{child}"]');button.wait_for(state='visible');activate(button)
        page.wait_for_function('(id)=>board.getState().selectedTaskId===id',arg=child)
        assert page.evaluate('innerWidth')==390
    for _ in range(backs):activate(page.locator('[data-detail-parent]'))
    page.evaluate('Object.assign(tasks[0],{title:"Origin remounted",revision:3});board.updateTask({...board.getState().tasks.get("t0"),title:"Origin remounted",revision:3})')
    assert not page.evaluate('originalOpener.isConnected')
    if change=='virtual':
        assert page.locator('#projects-board-rows [data-task-id="t0"]').count()==0
    elif change=='archived':page.evaluate('board.updateTask({...tasks[0],lifecycle:"archived",revision:3})')
    elif change=='actor':page.evaluate('actor="other"')
    elif change in ['filtered','filter-return']:
        page.evaluate('board.setFilters({search:"Công việc 3"})')
        page.wait_for_function('board.getState().authorizationReady')
        assert page.locator('#projects-board-rows [data-task-id="t0"]').count()==0
        assert page.evaluate('board.getState().selectedTaskId')=='t2'
        if change=='filter-return':
            page.evaluate('board.setFilters({})');page.wait_for_function('board.getState().authorizationReady')
    elif change=='access':page.evaluate('board.invalidateAccess("p")')
    elif change=='project':
        page.evaluate('board.setProjects({projects:[{id:"other",lifecycle:"active"}],selectedProjectId:"other"})')
        page.wait_for_function('board.getState().authorizationReady')
    dialog=page.locator('#projects-board-detail')
    if change in ['access','project']:
        assert not dialog.evaluate('e=>e.open')
        page.locator('#projects-workspace-name').evaluate('e=>{e.tabIndex=-1;e.focus()}')
        page.evaluate('board.closeTask()')
    elif kind=='Escape':page.keyboard.press('Escape')
    else:activate(page.get_by_role('button',name='Close task details'))
    assert not dialog.evaluate('e=>e.open')
    state=page.evaluate('({width:innerWidth,task:document.activeElement.closest("#projects-board-rows [data-task-id]")?.dataset.taskId||null,id:document.activeElement.id,openerConnected:originalOpener.isConnected})')
    assert state['width']==390
    if change in ['archived','actor','access','project','filtered']:assert state['task'] is None and state['id']=='projects-workspace-name',state
    else:assert state['task']=='t0',state
    page.screenshot(path=str(out/f'focus-{label}.png'))
    ax=page.context.new_cdp_session(page).send('Accessibility.getFullAXTree')
    (out/f'ax-focus-{label}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
    if change=='virtual':
        visible=page.evaluate('''()=>{const e=document.activeElement,r=e.getBoundingClientRect(),s=document.querySelector('#projects-board-scroll').getBoundingClientRect();return {top:r.top,bottom:r.bottom,scrollTop:s.top,scrollBottom:s.bottom,height:innerHeight,hit:e.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))}}''')
        assert visible['top']>=max(0,visible['scrollTop']) and visible['bottom']<=min(visible['height'],visible['scrollBottom']) and visible['hit'],visible
        state['visibleTarget']=visible
    return {'kind':kind,'backs':backs,'change':change,**state}


def assert_phone_controls(page,out,label):
    selectors=['#btn-projects-board-add-task','#projects-view-filters input[name="title"]','#projects-board-group-by','#btn-projects-board-add-section']
    controls=[page.locator(selector) for selector in selectors]
    controls += list(page.locator('#projects-view-tabs button:visible').all())
    # Scan the rendered toolbar regions too, so a new control cannot silently
    # escape the explicit minimum-target list (as Filter previously did).
    toolbar=':is(#projects-view-filters, #projects-view-tabs, .crm-projects-workspace-heading-actions) :is(button, input, select, summary):visible'
    controls += list(page.locator(toolbar).all())
    controls += [page.locator(selector) for selector in ['.crm-projects-workspace-filter > summary','#projects-v2-columns > summary','#projects-v2-members','[aria-label="Project menu"]']]
    targets=[]
    for control in controls:
        assert control.is_visible()
        box=control.bounding_box();assert box['width']>=44 and box['height']>=44,box
        assert box['x']>=0 and box['x']+box['width']<=page.evaluate('innerWidth')+1,box
        control.scroll_into_view_if_needed()
        hit=control.evaluate('''e=>{const r=e.getBoundingClientRect(),owns=([x,y])=>{const n=document.elementFromPoint(x,y);return n===e||e.contains(n)};
            return {hidden:e.getAttribute('aria-hidden'),clip:getComputedStyle(e).clip,inside:[[r.left+2,r.top+r.height/2],[r.right-2,r.top+r.height/2],[r.left+r.width/2,r.top+2],[r.left+r.width/2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]].map(owns),outside:[[r.left-2,r.top+r.height/2],[r.right+2,r.top+r.height/2],[r.left+r.width/2,r.top-2],[r.left+r.width/2,r.bottom+2]].map(owns)};
        }''')
        if hit['hidden']=='true':
            assert hit['clip']=='rect(0px, 0px, 0px, 0px)' and not any(hit['inside']+hit['outside']),hit
        else:
            assert all(hit['inside']) and not any(hit['outside']),hit
        targets.append({'control':control.get_attribute('id') or control.get_attribute('data-view'),**box})
    # Both labels are supported custom status values (under the 200-character limit).
    custom='Chưa bắt đầu công việc và cần phối hợp với nhiều thành viên'
    statuses=[]
    for text in [custom,custom+'; '+custom+'; '+custom]:
        page.evaluate('''text=>{board.getState().project.statusLabels={not_started:text};board.updateTask({...board.getState().tasks.get('t0'),status:'not_started',revision:2});}''',text)
        geometry=page.locator('[data-task-id="t0"] .crm-board-status-text').evaluate('''e=>{
            const pill=e.closest('button'),p=pill.getBoundingClientRect(),r=e.getBoundingClientRect(),css=getComputedStyle(e),range=document.createRange();range.selectNodeContents(e);
            const lines=Array.from(range.getClientRects()).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));
            return {text:e.textContent,whiteSpace:css.whiteSpace,overflow:css.overflow,textOverflow:css.textOverflow,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,pill:{left:p.left,right:p.right,top:p.top,bottom:p.bottom,height:p.height},lines,contained:lines.every(l=>l.left>=r.left-1&&l.right<=r.right+1&&l.top>=p.top&&l.bottom<=p.bottom)};
        }''')
        page.screenshot(path=str(out/f'phone-status-{label}-{len(text)}.png'),full_page=True)
        assert geometry['text']==text and geometry['whiteSpace']=='normal',geometry
        assert geometry['overflow']=='visible' and geometry['textOverflow']!='ellipsis',geometry
        assert geometry['scrollWidth']<=geometry['clientWidth'] and geometry['scrollHeight']<=geometry['clientHeight'],geometry
        assert geometry['contained'] and geometry['pill']['height']>=44,geometry
        if len(text)>100:assert len(geometry['lines'])>1 and geometry['pill']['height']>44,geometry
        assert page.evaluate('document.documentElement.scrollWidth-document.documentElement.clientWidth')<=1
        statuses.append(geometry)
    page.evaluate("board.getState().project.statusLabels={};board.updateTask({...board.getState().tasks.get('t0'),status:'not_started',revision:3})")
    return {'targets':targets,'statuses':statuses}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parents[3];out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    hashes,results,errors={},{},[]
    def source(name):
        data=(root/name).read_bytes();hashes[name]=hashlib.sha256(data).hexdigest();return data.decode('utf-8')
    panel=runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']();panel.feed(source('public/crm-admin.html'));markup=''.join(panel.parts)
    bindings=dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)",source('public/crm-admin.js')))
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        try:
            cases=[(f'{kind}-back{backs}',kind,backs,'remount') for kind in ['pointer','touch','Escape','keyboard-close'] for backs in [0,1,2]]
            cases += [(change,'Escape',0,change) for change in ['virtual','archived','actor','access','project','filtered','filter-return']]
            for label,kind,backs,change in cases:
                context=browser.new_context(viewport={'width':390,'height':900},has_touch=True)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',lambda r:r.abort())
                mount(page,source,markup,bindings)
                results['focus-'+label]=assert_descendant_close(page,out,label,kind,backs,change)
                context.close()
            for width in [390,699,700,980,1280,1600]:
                context=browser.new_context(viewport={'width':width,'height':900},has_touch=True)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',lambda route:route.abort())
                mount(page,source,markup,bindings,hold_initial_view=True)
                if width<700:results[f'phone-controls-{width}']=assert_phone_controls(page,out,str(width))
                if width==390:
                    results['hierarchy-touch']=assert_mobile_hierarchy(page,out)
                    results['hierarchy-keyboard']=assert_mobile_hierarchy(page,out,keyboard=True)
                table=page.locator('#projects-board-table');rows=page.locator('#projects-board-rows')
                assert table.get_attribute('data-presentation')==('list' if width<700 else 'table')
                overflow=page.evaluate('({page:document.documentElement.scrollWidth-document.documentElement.clientWidth,body:document.body.scrollWidth-document.body.clientWidth})')
                assert overflow['page']<=1,overflow
                assert rows.get_by_role('combobox',name='Status',exact=True).count()==0
                contrast=page.evaluate('''()=>{
                    const panel=document.querySelector('[data-panel=projects]'), result=[];
                    const luminance=rgb=>rgb.match(/[0-9.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
                    for(const dark of [false,true]) {panel.classList.toggle('projects-dark',dark);
                        for(const [i,status] of ['not_started','in_progress','blocked','done'].entries()) {
                            board.updateTask({...board.getState().tasks.get('t'+(i?i+2:0)),status});
                            const control=document.querySelector('#projects-board-rows [data-task-id="t'+(i?i+2:0)+'"] [data-action="pick-status"]'),css=getComputedStyle(control),a=luminance(css.color),b=luminance(css.backgroundColor);
                            result.push({dark,status,foreground:css.color,background:css.backgroundColor,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
                        }
                    }panel.classList.remove('projects-dark');return result;
                }''')
                assert all(item['ratio']>=4.5 for item in contrast),contrast
                if width<700:
                    assert rows.get_attribute('role')=='list';assert rows.locator('[role="listitem"]').count()==50
                    assert table.get_attribute('aria-rowcount') is None
                else:
                    assert table.get_attribute('role')=='table';assert int(table.get_attribute('aria-rowcount'))>rows.locator('[data-row-id]').count()
                # Actual keyboard ownership: one row Tab stop, Enter details, native caret, F2 and Escape.
                row=rows.locator('[data-task-id="t0"]')
                if width<700:
                    row.locator('[data-action="open-subtasks"]').tap();assert page.locator('#projects-board-detail').evaluate('e=>e.open');page.locator('#btn-projects-board-close-detail').tap()
                row.focus();page.keyboard.press('ArrowDown')
                assert page.evaluate('document.activeElement.dataset.taskId')=='t3'
                page.keyboard.press('ArrowUp');assert page.evaluate('document.activeElement.dataset.taskId')=='t0'
                page.keyboard.press('F2');rename=row.locator('[data-field-kind="title"]');rename.fill('Bản nháp có dấu tiếng Việt')
                rename.press('Home');rename.press('ArrowRight');assert rename.evaluate('e=>e.selectionStart')==1
                rename.press('Escape');assert row.locator('[data-field-kind="title"]').count()==0
                row.focus();page.keyboard.press('Space');assert row.locator('[data-action="select-task"]').is_checked()
                page.keyboard.press('Space');assert not row.locator('[data-action="select-task"]').is_checked()
                if width>=700:
                    row.focus();page.keyboard.press('ArrowRight');page.wait_for_selector('#projects-board-rows [data-task-id="t1"]')
                    row.focus();page.keyboard.press('ArrowRight');assert page.evaluate('document.activeElement.dataset.taskId')=='t1'
                    page.keyboard.press('ArrowLeft');assert page.evaluate('document.activeElement.dataset.taskId')=='t0'
                row.focus();page.keyboard.press('Enter');dialog=page.locator('#projects-board-detail');assert dialog.evaluate('e=>e.open')
                modal=width<1000;assert dialog.evaluate('e=>e.matches(":modal")')==modal
                assert dialog.evaluate('e=>e.scrollWidth-e.clientWidth')<=1
                results[f'predecessor-disabled-{width}']=assert_predecessor_name(page,out,f'disabled-{width}')
                assert results[f'predecessor-disabled-{width}']['disabled']
                page.evaluate('window.releaseInitialView();views.refresh()');page.wait_for_function('!document.querySelector("#projects-task-predecessors").disabled')
                results[f'predecessor-enabled-{width}']=assert_predecessor_name(page,out,f'enabled-{width}')
                assert not results[f'predecessor-enabled-{width}']['disabled']
                assert page.locator('#projects-task-predecessor-picker option').count()>1
                results[f'disclosure-{width}']=assert_disclosure_keys(page,out,str(width))
                # Picker is in the modal subtree; Escape closes only it and returns to the exact trigger.
                for selector,popup in [('[data-action="pick-status"]','.crm-status-popover'),('[data-people-kind="ownerUid"]','.crm-people-popover'),('[data-action="edit-dates"]','.crm-row-editor')]:
                    trigger=dialog.locator(selector).first;trigger.focus();page.keyboard.press('Enter');picker=dialog.locator(popup);picker.wait_for(state='visible')
                    assert picker.evaluate('e=>e.closest("dialog")?.open')
                    assert picker.evaluate('e=>e.contains(document.activeElement)')
                    box=picker.bounding_box();assert box['x']>=-1 and box['x']+box['width']<=width+1,box
                    page.keyboard.press('Escape');assert page.locator(popup).count()==0;assert dialog.evaluate('e=>e.open')
                    assert trigger.evaluate('e=>e===document.activeElement'),selector
                if modal:
                    assert dialog.locator('#btn-projects-board-close-detail').bounding_box()['height']>=44
                notes=dialog.locator('[data-column-id="notes"].crm-board-field');notes.focus();notes.fill('Bản nháp dài giữ nguyên dấu và vị trí con trỏ')
                notes.evaluate('e=>e.setSelectionRange(4,9)');page.set_viewport_size({'width':1280 if modal else 390,'height':900})
                page.wait_for_function('(expected)=>document.querySelector("#projects-board-detail").dataset.detailMode===expected',arg='drawer' if modal else 'modal')
                assert notes.evaluate('e=>e===document.activeElement&&e.selectionStart===4&&e.selectionEnd===9'), {'width':width,'focus':notes.evaluate('e=>({active:document.activeElement.outerHTML,start:e.selectionStart,end:e.selectionEnd,connected:e.isConnected})')}
                page.set_viewport_size({'width':width,'height':900})
                page.wait_for_function('(expected)=>document.querySelector("#projects-board-detail").dataset.detailMode===expected',arg='modal' if modal else 'drawer')
                page.evaluate('fail=500');notes.fill('Bản nháp chưa lưu cần giữ lại');notes.press('Tab')
                page.wait_for_function('document.querySelector("#projects-board-detail [data-column-id=notes].crm-board-field").getAttribute("aria-invalid")==="true"')
                assert notes.evaluate('e=>document.getElementById(e.getAttribute("aria-describedby"))?.getAttribute("role")==="status"')
                assert notes.input_value()=='Bản nháp chưa lưu cần giữ lại';page.evaluate('fail=0')
                assert dialog.locator('[role="cell"]').count()==0
                assert dialog.locator('[role="group"][aria-label="Notes"]').count()==1
                assert dialog.evaluate('e=>e.scrollWidth-e.clientWidth')<=1
                # Raw Chrome AX tree supports semantic inspection; this is not a human screen-reader session.
                cdp=context.new_cdp_session(page);ax=cdp.send('Accessibility.getFullAXTree');(out/f'ax-detail-{width}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
                names=[n.get('name',{}).get('value','') for n in ax['nodes'] if not n.get('ignored')]
                assert 'Task title' in names and 'Close task details' in names,names
                dialog.evaluate('e=>e.scrollTop=0');page.screenshot(path=str(out/f'detail-{width}.png'))
                page.keyboard.press('Escape');assert not dialog.evaluate('e=>e.open')
                assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId')=='t0'
                # View arrows move focus only; Enter activates and Back remains owned by view navigation.
                tabs=page.locator('#projects-view-tabs [data-view]');tabs.first.focus();before=page.evaluate('calls.length');page.keyboard.press('ArrowRight')
                assert page.evaluate('document.activeElement.dataset.view')=='kanban';assert page.evaluate('calls.length')==before
                page.keyboard.press('Enter');page.wait_for_function('document.querySelector("[data-view=kanban]").getAttribute("aria-pressed")==="true"')
                page.set_viewport_size({'width':390,'height':900});assert page.locator('[data-view="kanban"]').get_attribute('aria-pressed')=='true'
                page.locator('[data-view="board"]').click();page.set_viewport_size({'width':width,'height':900})
                page.wait_for_function('(expected)=>document.querySelector("#projects-board-table").dataset.presentation===expected',arg='list' if width<700 else 'table')
                if width<700:
                    hit=row.locator('.crm-board-selection-hit');box=hit.locator('input')
                    assert hit.bounding_box()['width']>=44 and hit.bounding_box()['height']>=44
                    assert box.bounding_box()['width']<=20 and box.bounding_box()['height']<=20
                    hit.tap();assert box.is_checked();hit.tap();assert not box.is_checked()
                    leaf=page.locator('#projects-board-rows [data-task-id="t3"]')
                    assert leaf.locator('[data-action="open-subtasks"]:visible').count()==0
                    row.locator('[data-action="task-menu"]').tap();page.locator('[data-add-child]').wait_for(state='visible');page.keyboard.press('Escape')
                    touch=row.locator('.crm-board-title-button');assert touch.bounding_box()['height']>=44
                    assert row.locator('[data-action="pick-status"]').bounding_box()['height']>=44
                    touch.tap();assert dialog.evaluate('e=>e.open');page.locator('#btn-projects-board-close-detail').tap()
                page.emulate_media(forced_colors='active',reduced_motion='reduce');row.focus();page.keyboard.press('ArrowDown')
                assert page.evaluate('getComputedStyle(document.activeElement).outlineStyle')!='none'
                page.screenshot(path=str(out/f'forced-colors-{width}.png'));page.emulate_media(forced_colors='none');page.screenshot(path=str(out/f'list-table-{width}.png'))
                ax=cdp.send('Accessibility.getFullAXTree');(out/f'ax-table-list-{width}.json').write_text(json.dumps(ax,ensure_ascii=False,indent=2),encoding='utf-8')
                results[str(width)]={'overflow':overflow,'modal':modal,'keyboard':True,'pickerContainment':True,'caretAcrossResize':True,'touch':width==390,'forcedColors':True,'statusContrast':contrast}
                context.close()
            for boundary in ['actor','project','access']:
                context=browser.new_context(viewport={'width':390,'height':844});race=context.new_page();race.on('pageerror',lambda e:errors.append(str(e)));race.route('**/*',lambda r:r.abort());mount(race,source,markup,bindings)
                race.evaluate('holdNext=true');race.locator('#projects-board-rows [data-task-id="t0"] [data-action="pick-status"]').click();race.locator('[data-status-key="done"]').click();race.wait_for_function('typeof release==="function"')
                if boundary=='actor':race.evaluate('actor="other";board.invalidateAccess("p")')
                elif boundary=='project':race.evaluate('board.setProjects({projects:[{id:"other",lifecycle:"active"}],selectedProjectId:"other"})')
                else:race.evaluate('role="Viewer";board.invalidateAccess("p")')
                race.evaluate('release()');race.wait_for_function('!document.querySelector(".crm-status-popover")')
                assert race.evaluate('calls.filter(c=>c.method==="PATCH").length')==1
                assert race.locator('#projects-board-rows [data-task-id="t0"] [data-action="pick-status"]:not(:disabled)').count()==0
                results['stale-'+boundary]={'writes':1,'pickerClosed':True,'noReenabledControls':True};context.close()
            context=browser.new_context(viewport={'width':390,'height':900},has_touch=True)
            paging=context.new_page();paging.on('pageerror',lambda e:errors.append(str(e)));paging.route('**/*',lambda r:r.abort());mount(paging,source,markup,bindings)
            paging.evaluate('''()=>{childPageSize=60;failChild=500;tasks.push(...Array.from({length:79},(_,i)=>({id:'extra'+i,title:'Công việc con bổ sung '+i,parentTaskId:'t0',sectionId:'s',rank:(100+i)+'/1',revision:1,activeChildCount:0})));}''')
            paging.locator('#projects-board-rows [data-task-id="t0"] [data-action="open-subtasks"]').tap()
            more=paging.get_by_role('button',name='Retry loading subtasks',exact=True);more.wait_for(state='visible')
            assert paging.locator('[data-detail-child]').count()==0
            paging.screenshot(path=str(out/'children-first-failure-390.png'))
            paging.evaluate('failChild=0');more.tap();paging.wait_for_function('document.querySelectorAll("[data-detail-child]").length===50')
            paging.get_by_role('button',name='Show more loaded subtasks',exact=True).tap()
            assert paging.locator('[data-detail-child]').count()==60
            paging.evaluate('failChild=500');paging.get_by_role('button',name='Load more subtasks',exact=True).tap();more.wait_for(state='visible')
            assert paging.locator('[data-detail-child]').count()==60
            paging.evaluate('failChild=0');more.tap();paging.wait_for_function('document.querySelectorAll("[data-detail-child]").length===80')
            assert paging.locator('[data-detail-child]').last.evaluate('e=>e.getBoundingClientRect().width<=document.querySelector("#projects-board-detail").clientWidth')
            assert paging.locator('#projects-board-detail').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
            cursors=paging.evaluate('calls.filter(c=>c.url.includes("/tasks?")).map(c=>new URL(c.url,"https://fixture.invalid")).filter(u=>JSON.parse(u.searchParams.get("filters")).parentTaskId==="t0").map(u=>u.searchParams.get("cursor"))')
            assert cursors==[None,None,'60','60'],cursors
            paging.locator('[data-detail-child]').last.tap();paging.locator('[data-detail-parent]').tap()
            assert paging.locator('[data-detail-child]').last.evaluate('e=>e===document.activeElement')
            assert paging.locator('[data-detail-child]').count()==80
            paging.screenshot(path=str(out/'children-paged-390.png'));results['child-paging']={'cursors':cursors,'boundedPrefix':50,'loaded':80,'retryFirstAndAppend':True};context.close()
            for boundary in ['actor','project','access']:
                for reject in [False,True]:
                    context=browser.new_context(viewport={'width':390,'height':900},has_touch=True)
                    race=context.new_page();race.on('pageerror',lambda e:errors.append(str(e)));race.route('**/*',lambda r:r.abort());mount(race,source,markup,bindings)
                    race.evaluate('(reject)=>{holdChild=true;rejectChild=reject}',reject)
                    race.locator('#projects-board-rows [data-task-id="t0"] [data-action="open-subtasks"]').tap();race.wait_for_function('typeof releaseChild==="function"')
                    assert race.get_by_text('Loading subtasks…',exact=True).is_visible()
                    if boundary=='actor':race.evaluate('actor="other";board.invalidateAccess("p")')
                    elif boundary=='project':race.evaluate('board.setProjects({projects:[{id:"other",lifecycle:"active"}],selectedProjectId:"other"})');race.wait_for_function('board.getState().authorizationReady')
                    else:race.evaluate('role="Viewer";board.invalidateAccess("p")')
                    race.evaluate('releaseChild()');race.wait_for_function('!document.querySelector("#projects-board-detail").open')
                    assert not race.evaluate('board.getState().tasks.has("t1")')
                    assert race.locator('[data-detail-child]').count()==0
                    if boundary=='project':assert race.evaluate('board.getState().authorizationReady')
                    results[f'child-stale-{boundary}-{reject}']={'discarded':True,'closed':True};context.close()
            # Chrome's actual Page zoom preference, isolated from the user's profile.
            profile=out/'chrome-zoom-profile'
            zoom_context=pw.chromium.launch_persistent_context(str(profile),channel='chrome',headless=True,no_viewport=True,args=['--window-size=1280,1000'])
            try:
                settings=zoom_context.new_page();settings.goto('chrome://settings/appearance');settings.locator('#zoomLevel').select_option('2')
                assert settings.locator('#zoomLevel').input_value()=='2'
                settings.screenshot(path=str(out/'chrome-setting-200.png'))
                zoom=zoom_context.new_page();zoom.route('**/*',lambda r:r.fulfill(body='<html></html>',content_type='text/html') if r.request.url=='http://pr10.test/' else r.abort())
                zoom.goto('http://pr10.test/');mount(zoom,source,markup,bindings)
                metrics=zoom.evaluate('({inner:innerWidth,outer:outerWidth,dpr:devicePixelRatio,visualScale:visualViewport.scale,bodyZoom:getComputedStyle(document.body).zoom,panelZoom:getComputedStyle(document.querySelector("[data-panel=projects]")).zoom,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth})')
                assert 600<=metrics['inner']<=650 and metrics['dpr']==2 and metrics['visualScale']==1 and metrics['bodyZoom']=='1' and metrics['panelZoom']=='1',metrics
                assert metrics['overflow']<=1,metrics
                assert zoom.locator('#projects-board-table').get_attribute('data-presentation')=='list'
                results['phone-controls-zoom200']=assert_phone_controls(zoom,out,'zoom200')
                task=zoom.locator('#projects-board-rows [data-task-id="t0"]');task.focus();zoom.keyboard.press('Enter');dialog=zoom.locator('#projects-board-detail')
                assert dialog.evaluate('e=>e.matches(":modal")&&e.scrollWidth<=e.clientWidth+1')
                heading_geometry=dialog.locator('.crm-projects-board-detail-head').evaluate('''head=>{const header=head.getBoundingClientRect(),text=head.firstElementChild.getBoundingClientRect(),title=head.querySelector('h4'),close=head.querySelector('button').getBoundingClientRect(),dialog=head.closest('dialog').getBoundingClientRect();return {contained:header.top>=dialog.top&&text.right<=close.left+1&&text.left>=dialog.left&&close.right<=dialog.right+1&&title.scrollWidth<=title.clientWidth&&title.scrollHeight<=title.clientHeight,header:{top:header.top,height:header.height},text:{left:text.left,right:text.right,width:text.width},title:{clientWidth:title.clientWidth,scrollWidth:title.scrollWidth,clientHeight:title.clientHeight,scrollHeight:title.scrollHeight,value:title.textContent},close:{left:close.left,right:close.right,width:close.width},dialog:{top:dialog.top,left:dialog.left,right:dialog.right,width:dialog.width}}}''')
                assert heading_geometry['contained'],heading_geometry
                results['zoomHeading']=heading_geometry
                trigger=dialog.locator('[data-people-kind="ownerUid"]');trigger.click();assert dialog.locator('.crm-people-popover').evaluate('e=>e.contains(document.activeElement)')
                zoom.keyboard.press('Escape');assert trigger.evaluate('e=>e===document.activeElement')
                zoom.evaluate('views.refresh()');results['disclosure-zoom200']=assert_disclosure_keys(zoom,out,'zoom200')
                results['predecessor-zoom200']=assert_predecessor_name(zoom,out,'zoom200')
                zoom.screenshot(path=str(out/'browser-zoom-200-detail.png'))
                zoom.keyboard.press('Escape');task.scroll_into_view_if_needed();zoom.screenshot(path=str(out/'browser-zoom-200-list.png'),full_page=True)
                results['browserZoom200']=metrics
            finally:zoom_context.close()
        finally:browser.close()
    assert not errors,errors
    (out/'report.json').write_text(json.dumps({'results':results,'errors':errors,'sourceHashes':hashes},indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(results),'errors':errors}))
if __name__=='__main__':main()
