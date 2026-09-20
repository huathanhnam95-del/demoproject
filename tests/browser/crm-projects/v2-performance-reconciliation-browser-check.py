"""PR11 deterministic Chrome measurements; synthetic APIs, all root rows loaded to stress DOM; view responses capped at 200."""
import argparse
import hashlib
import json
import re
import runpy
import subprocess
import platform
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--source-ref')
    parser.add_argument('--cpu-rate', type=int, default=1)
    parser.add_argument('--regressions-only', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    hashes, results, errors = {}, [], []

    def source(name):
        data = subprocess.check_output(['git','show',args.source_ref+':'+name],cwd=root) if args.source_ref and name.startswith('public/') else (root / name).read_bytes()
        hashes[name] = hashlib.sha256(data).hexdigest()
        return data.decode('utf-8')

    source('tests/browser/crm-projects/v2-performance-reconciliation-browser-check.py')

    panel = runpy.run_path(str(Path(__file__).with_name('v2-wave1-browser-check.py')))['ProjectsPanel']()
    panel.feed(source('public/crm-admin.html'))
    html = '<!doctype html><html><body class="crm-admin">' + ''.join(panel.parts) + '</body></html>'
    bindings = dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)", source('public/crm-admin.js')))
    def open_fixture(context, url, count):
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=html) if route.request.resource_type == 'document' else route.abort())
        page.goto(url)
        for name in ['design-tokens.css', 'crm-admin.css', 'css/crm-projects.css', 'css/crm-projects-v2.css']:
            page.add_style_tag(content=source('public/' + name))
        page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
        page.evaluate("document.querySelector('[data-panel=projects]').dataset.projectsUi='v2'")
        for name in ['presentation/column-model', 'presentation/table-layout', 'presentation/field-feedback', 'state', 'presentation/detail-surface', 'board', 'discussion', 'views', 'workspace', 'presentation/ui-preferences', 'presentation/shell', 'presentation/entry']:
            page.add_script_tag(content=source(f'public/js/crm/projects/{name}.js'))
        page.add_script_tag(content=source('tests/fixtures/crm/projects-v2-performance.js'))
        page.evaluate('async args => { window.h = await createProjectsPerformanceFixture(args.bindings, args.count); }', {'bindings':bindings,'count':count})
        page.wait_for_load_state('networkidle')
        return page

    def regressions(browser):
        observations = []
        for kind in ['edit', 'redaction', 'unavailable', 'hydrate', 'fallback']:
            context = browser.new_context(viewport={'width':1280,'height':900})
            page = open_fixture(context, 'https://fixture.invalid/crm-admin.html#projects', 30)
            page.evaluate("""async()=>{
                h.messages=Array.from({length:65},(_,i)=>({id:'m'+i,taskId:'p0',body:'Update '+i,revision:1,authorUid:'a',createdAt:new Date(Date.UTC(2026,8,1,0,0,65-i)).toISOString()}));
                await h.views.openTask('p0');h.board.activateDetailTab('updates');await h.wait();await h.discussion.refresh({append:true});
            }""")
            composer = page.locator('#projects-board-discussion-input')
            composer.fill('Retained draft'); composer.evaluate('e=>e.setSelectionRange(2,6)')
            page.locator('#projects-board-discussion-file').set_input_files({'name':'retained.txt','mimeType':'text/plain','buffer':b'retained'})
            page.locator('[data-detail-tab=details]').click()
            observation = page.evaluate("""async kind=>{
                h.calls.length=0;const row=h.messages[64];row.revision++;
                if(kind==='redaction')Object.assign(row,{body:null,redacted:true,moderationState:'hidden'});
                else row.body='Edited older body';
                if(kind==='unavailable')h.messages=h.messages.filter(m=>m.id!=='m64');
                const change={isCurrent:()=>true,cursor:'repair',messageIds:[],changes:[],authority:{project:{...h.board.getState().project},membership:{role:h.role}},hydration:{tasks:[],messages:[],unavailableTaskIds:[],unavailableMessageIds:[]}};
                if(['hydrate','fallback'].includes(kind)){change.discussionRefresh=true;change.hydrationFallback=kind==='fallback';}
                else if(kind==='unavailable')change.hydration.unavailableMessageIds=['m64'];else change.hydration.messages=[{...row}];
                const ack=await h.remote(change);h.board.activateDetailTab('updates');await h.wait();
                return {kind,ack,messages:h.discussion.getState().messages,requests:h.calls.slice()};
            }""", kind)
            assert observation['ack']
            older = next((m for m in observation['messages'] if m['id']=='m64'),None)
            if kind=='unavailable': assert older is None
            elif kind=='redaction': assert older['redacted'] and older['body'] is None
            else: assert older['body']=='Edited older body'
            reads=[c for c in observation['requests'] if '/discussion' in c['url'] or '/changes/hydrate' in c['url']]
            assert len(reads)==(3 if kind=='hydrate' else 2 if kind=='fallback' else 0)
            assert composer.input_value()=='Retained draft' and composer.evaluate('e=>e.selectionStart')==2
            assert page.locator('#projects-board-discussion-file').evaluate('e=>e.files.length')==1
            page.evaluate('h.board.activateDetailTab("details");h.calls.length=0')
            page.evaluate("""async()=>{for(let i=0;i<4;i++)await h.remote({isCurrent:()=>true,changes:[],authority:{project:{...h.board.getState().project},membership:{role:h.role}},hydration:{tasks:[],messages:[],unavailableTaskIds:[],unavailableMessageIds:[]}});h.board.activateDetailTab('updates');await h.wait();}""")
            assert page.evaluate("h.calls.filter(c=>c.url.includes('/discussion')).length")==0
            target = page.locator(f'[data-message-id={"m63" if kind=="unavailable" else "m64"}]')
            target.scroll_into_view_if_needed()
            if kind=='redaction': assert 'This message is unavailable.' in target.inner_text()
            elif kind!='unavailable': assert 'Edited older body' in target.inner_text()
            page.screenshot(path=str(out/f'hidden-{kind}.png'));observations.append(observation)
            page.evaluate('h.close()');context.close()
        for boundary in ['role','membership','refresh']:
            for order in ['old-first','new-first']:
                context=browser.new_context(viewport={'width':1280,'height':900})
                page=open_fixture(context,'https://fixture.invalid/crm-admin.html#projects',30)
                page.evaluate("async()=>{window.old=h.hold('/calendar?');h.views.setView('calendar');await h.wait();}")
                page.evaluate("""async boundary=>{
                    h.calendarStatus='unverified';if(boundary==='role')h.role='Viewer';if(boundary==='membership')h.membershipRevision++;
                    window.fresh=h.hold('/calendar?');
                    await h.remote({isCurrent:()=>true,authorityChanged:boundary!=='refresh',refresh:boundary==='refresh',messageIds:[],changes:[],authority:{project:{...h.board.getState().project,membershipRevision:h.membershipRevision},membership:{role:h.role}},hydration:{tasks:[],messages:[],unavailableTaskIds:[],unavailableMessageIds:[]}});
                    await h.wait();h.views.setView('calendar');h.views.setView('calendar');
                }""",boundary)
                assert page.evaluate("h.calls.filter(c=>c.url.includes('/calendar?')).length")==2
                page.evaluate(f'async()=>{{{ "old" if order=="old-first" else "fresh" }();await h.wait();}}')
                assert 'Verified' not in page.locator('#projects-calendar-view-provenance').inner_text()
                page.evaluate(f'async()=>{{{ "fresh" if order=="old-first" else "old" }();await h.wait();h.views.setView("kanban");h.views.setView("calendar");await h.wait();}}')
                assert 'Verified' not in page.locator('#projects-calendar-view-provenance').inner_text()
                assert page.evaluate("h.calls.filter(c=>c.url.includes('/calendar?')).length")==2
                observations.append({'boundary':boundary,'order':order,'requests':page.evaluate('h.calls.slice()')})
                page.screenshot(path=str(out/f'calendar-{boundary}-{order}.png'));page.evaluate('h.close()');context.close()
        (out/'report.json').write_text(json.dumps({'regressions':observations,'sourceHashes':hashes,'errors':errors,'browser':browser.version},indent=2),encoding='utf-8')
        assert not errors,errors
        print(f'PASS: {len(observations)} consistency regressions')

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            if args.regressions_only:
                regressions(browser)
                return
            for count in [30, 500, 5000]:
                context=browser.new_context(viewport={'width':1280,'height':900})
                page=open_fixture(context,'https://fixture.invalid/crm-admin.html#projects',count)
                cdp=context.new_cdp_session(page); cdp.send('Performance.enable'); cdp.send('Emulation.setCPUThrottlingRate',{'rate':args.cpu_rate})
                page.evaluate("""()=>{window.perf={long:[],frames:[]};window.po=new PerformanceObserver(l=>{perf.long.push(...l.getEntries().map(e=>e.duration));});po.observe({type:'longtask'});}""")
                metrics={'tasks':count,'loaded':page.evaluate('h.board.getState().tasks.size'),'actions':{}}
                def action(name,js):
                    page.evaluate('h.calls.length=0')
                    result=page.evaluate("""async script=>{const start=performance.now();await eval(script);const end=performance.now();await new Promise(requestAnimationFrame);return {localMs:end-start,firstFrameMs:performance.now()-start};}""",js)
                    page.evaluate('h.wait()')
                    result['requests']=page.evaluate('h.calls.slice()')
                    result['dom']=page.locator('*').count();result['rows']=page.locator('#projects-board-rows [data-row-kind=task]').count()
                    metrics['actions'][name]=result
                    return result
                opened=action('overview',"h.views.openTask('p0')")
                updates=action('updates',"h.board.activateDetailTab('updates')")
                if not args.baseline:
                    assert not any('/discussion' in x['url'] for x in opened['requests'])
                    assert sum('/discussion' in x['url'] for x in updates['requests'])==1
                action('close',"h.board.closeTask()")
                page.screenshot(path=str(out/f'table-{count}.png'))
                action('kanban',"h.views.setView('kanban')")
                saved=action('save',"h.command('p0','title','Measured saved title')")
                echoed=action('echo',"h.remote({isCurrent:()=>true,authority:{project:{...h.board.getState().project},membership:{role:'Owner'}},changes:[{operationId:h.tasks[0].operationId,taskIds:['p0'],command:'updateTask'}],hydration:{tasks:[{...h.tasks[0]}]}})")
                if not args.baseline:
                    assert sum('/views?' in x['url'] for x in saved['requests']+echoed['requests'])==1
                    assert not any('/links' in x['url'] for x in saved['requests']+echoed['requests'])
                changed=action('remote-unloaded',"(async()=>{const task=h.tasks.find(t=>t.id==='p4');task.title='Changed unloaded task';task.revision++;await h.remote({isCurrent:()=>true,authority:{project:{...h.board.getState().project},membership:{role:'Owner'}},changes:[{taskIds:['p4'],command:'updateTask'}],hydration:{tasks:[{...task}]}});})()")
                assert sum('/views?' in x['url'] for x in changed['requests'])==1
                assert page.evaluate("h.views.getState().response.tasks.find(t=>t.id==='p4').revision")==2
                if count==30:
                    repeated=action('repeated-activation',"(()=>{const release=h.hold('/views?');h.views.setView('calendar');h.views.setView('calendar');h.views.refresh();h.views.refresh();release();})()")
                    if not args.baseline:assert sum('/views?' in x['url'] for x in repeated['requests'])==1
                for view in ['gantt','charts','calendar','board']:
                    action(view,f"h.views.setView('{view}')")
                action('density',"h.board.setDensity('compact',1)")
                page.set_viewport_size({'width':390,'height':844});page.evaluate('h.wait()')
                metrics['mobile']={'rows':page.locator('#projects-board-rows [data-row-kind=task]').count(),'dom':page.locator('*').count()}
                page.screenshot(path=str(out/f'mobile-{count}.png'))
                growth=[]
                for _ in range(6):
                    more=page.locator('[data-mobile-more]')
                    if not more.is_visible():break
                    more.click();growth.append(page.locator('#projects-board-rows [data-row-id]').count())
                metrics['mobilePagingRows']=growth
                if not args.baseline:
                    assert all(n<=208 for n in growth)
                    earlier=page.locator('[data-mobile-previous]')
                    if earlier.is_visible():
                        earlier.click();assert page.evaluate("!!document.activeElement.closest('[data-row-id]')")
                page.screenshot(path=str(out/f'mobile-paged-{count}.png'))
                page.evaluate("h.board.selectTask(h.board.getState().tasks.get('p0'));h.board.activateDetailTab('updates')")
                composer=page.locator('#projects-board-discussion-input');composer.fill('Synthetic retained draft');composer.evaluate('e=>e.setSelectionRange(2,7)')
                page.locator('#projects-board-discussion-file').set_input_files({'name':'synthetic.txt','mimeType':'text/plain','buffer':b'synthetic'})
                for width in [1280,390,980,390]:page.set_viewport_size({'width':width,'height':844});page.evaluate('h.wait()')
                assert composer.input_value()=='Synthetic retained draft'
                assert composer.evaluate('e=>e.selectionStart')==2
                assert page.locator('#projects-board-discussion-file').evaluate('e=>e.files.length')==1
                action('repeat-tabs',"h.board.activateDetailTab('details');h.board.activateDetailTab('updates')")
                # Real navigation history must preserve task/tab identity without writes.
                page.evaluate("h.views.openTask('p1')");page.go_back();page.evaluate('h.wait()')
                assert page.evaluate('h.board.getState().selectedTaskId')=='p0'
                page.go_forward();page.evaluate('h.wait()');assert page.evaluate('h.board.getState().selectedTaskId')=='p1'
                page.evaluate('h.board.closeTask()')
                cdp.send('HeapProfiler.collectGarbage');metrics['warmDomCounters']=cdp.send('Memory.getDOMCounters')
                for _ in range(6):
                    page.evaluate("h.board.selectTask(h.board.getState().tasks.get('p0'));h.board.closeTask();h.views.init();h.discussion.init()")
                cdp.send('HeapProfiler.collectGarbage');metrics['cycleDomCounters']=cdp.send('Memory.getDOMCounters')
                metrics['contextSubscriptions']=page.evaluate('h.contextSubscriptions')
                page.evaluate("async ()=>{const children=h.tasks.filter(t=>t.projectId==='q'&&t.id!=='q0');children.forEach(t=>{t.parentTaskId='q0';t.ancestorIds=['q0'];t.activeChildCount=0;});h.tasks.find(t=>t.id==='q0').activeChildCount=children.length;await h.select('q');await h.wait();h.board.selectTask(h.board.getState().tasks.get('q0'));await h.wait();}")
                childGrowth=[]
                for _ in range(6):
                    more=page.locator('[data-detail-children-more]')
                    if not more.is_visible():break
                    more.click();childGrowth.append(page.locator('[data-detail-child]').count())
                metrics['childPagingRows']=childGrowth
                if not args.baseline:assert all(n<=200 for n in childGrowth)
                child=page.locator('[data-detail-child]').last
                if child.count():
                    child_id=child.get_attribute('data-detail-child');child.click();page.locator('[data-detail-parent]').click()
                    assert page.evaluate('document.activeElement.dataset.detailChild')==child_id
                    if not args.baseline:assert page.locator('[data-detail-child]').count()<=200
                page.screenshot(path=str(out/f'children-paged-{count}.png'))
                (out/f'metrics-{count}.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
                if not args.baseline:
                    assert metrics['contextSubscriptions']==1
                    assert metrics['cycleDomCounters']['jsEventListeners']<=metrics['warmDomCounters']['jsEventListeners']+10
                metrics['longTasks']=page.evaluate('perf.long');metrics['performance']=cdp.send('Performance.getMetrics');metrics['domCounters']=cdp.send('Memory.getDOMCounters')
                if not args.baseline:
                    assert max(a['rows'] for key,a in metrics['actions'].items() if key!='repeat-tabs')<=90
                    assert metrics['actions']['repeat-tabs']['rows']<=208
                    assert metrics['mobile']['rows']<=60
                page.evaluate('po.disconnect();h.close()');metrics['disposedDomCounters']=cdp.send('Memory.getDOMCounters')
                results.append(metrics);context.close()
        finally:browser.close()
    (out/'report.json').write_text(json.dumps({'results':results,'errors':errors,'sourceHashes':hashes,'browser':browser.version,'sourceRef':args.source_ref,'cpuRate':args.cpu_rate,'environment':platform.platform(),'conditions':'Headless installed Chrome; synthetic in-process API; no network latency or backend capacity measurement; original first-prefix behavior plus repeated mobile paging and lifecycle measurements'},indent=2),encoding='utf-8')
    assert not errors,errors
    print(f'PASS: {len(results)} scale measurements')
if __name__=='__main__':main()
