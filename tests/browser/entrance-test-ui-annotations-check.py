"""Chrome-only annotation acceptance. Synthetic adapter is explicitly not production proof."""
import argparse
import sys
sys.dont_write_bytecode = True
import importlib.util
import json
import math
from pathlib import Path
from playwright.sync_api import sync_playwright
spec=importlib.util.spec_from_file_location('demo_checks',Path(__file__).with_name('entrance-test-ui-demo-check.py'))
demo=importlib.util.module_from_spec(spec);spec.loader.exec_module(demo)
SETUP="""async () => {
 const {createAnnotationsController}=await import('/js/crm/entrance-test-ui/annotations-controller.js');
 const key='annotation-fixture-v1'; const read=()=>JSON.parse(localStorage.getItem(key)||'{}'); const listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 window.fixtureOffline=false;
 const page=()=>({items:Object.entries(read()).map(([id,d])=>({id,...d})).sort((a,b)=>b.createdAt-a.createdAt),cursor:null,more:false});
 const adapter={ref:id=>id,timestamp:()=>Date.now(),read:async id=>({id,...read()[id]}),page:async()=>page(),listen:(_cursor,fn)=>{const run=()=>fn(page());listeners.add(run);run();return()=>listeners.delete(run);},transaction:async fn=>{if(window.fixtureOffline)throw new Error('Offline: retry when connected');let pending;const result=await fn({get:async id=>({exists:!!read()[id],data:()=>read()[id]}),set:(id,d)=>{pending={id,d};}});if(pending){const all=read();all[pending.id]=pending.d;localStorage.setItem(key,JSON.stringify(all));emit();}return result;}};
 let authListener;const auth={onAuthStateChanged:fn=>{authListener=fn;fn({uid:'fixture-admin'});return()=>{};}};window.fixtureSignOut=()=>authListener(null);window.fixtureSignIn=()=>authListener({uid:'fixture-admin'});
 window.annotationFixture=createAnnotationsController({mount:document.querySelector('#et-annotations-mount'),frame:document.querySelector('#et-ui-frame'),getRater:()=>({id:'reviewer',name:'Reviewer'}),adapter,auth});
 window.addEventListener('storage',emit);
} """
def prepare(page,base):
    page.goto(base+'/__fixtures__/evaluator-host.html')
    if page.locator('#et-ui-name').count():
        page.locator('#et-ui-name').fill('Reviewer');page.locator('#et-ui-enter').click()
    page.wait_for_function("document.querySelector('#et-ui-status')?.textContent === ''")
    page.locator("[data-skin='d']").click()
    page.frame_locator('#et-ui-frame').locator('[data-view]').wait_for()
    page.evaluate(SETUP)
    page.get_by_role('button',name='Annotate',exact=True).wait_for()
    page.wait_for_function("!document.querySelector('.et-annotation-toolbar button').disabled")
    return page.frame_locator('#et-ui-frame')
def emulator_case(browser,base,output):
    import os,re,uuid,urllib.request
    firestore=os.environ.get('FIRESTORE_EMULATOR_HOST','');auth=os.environ.get('FIREBASE_AUTH_EMULATOR_HOST','')
    if not re.fullmatch(r'(127\.0\.0\.1|localhost):[0-9]+',firestore) or not re.fullmatch(r'(127\.0\.0\.1|localhost):[0-9]+',auth):
        raise RuntimeError('Explicit loopback Firestore and Auth emulators are required')
    project='demo-entrance-test-annotations';email='annotation-'+uuid.uuid4().hex+'@example.test';password=uuid.uuid4().hex
    config={'apiKey':'demo-key','projectId':project,'authDomain':project+'.firebaseapp.com'}
    body='Emulator persisted '+uuid.uuid4().hex
    def route_api(route):
        path=route.request.url.split(base)[-1]
        if path.startswith('/api/config'):route.fulfill(json={'success':True,'config':config})
        elif path.startswith('/api/admin/status'):route.abort()
        else:route.fulfill(json={'success':True,'items':[],'data':[],'projects':[],'students':[],'courses':[],'classrooms':[],'leads':[],'invoices':[],'payments':[],'enrollments':[],'sources':[]})
    def setup_context(create):
        ctx=browser.new_context(viewport={'width':1440,'height':1000});
        allowed=[base,'http://'+firestore,'http://'+auth,'https://www.gstatic.com/','https://fonts.googleapis.com/','https://fonts.gstatic.com/'];ctx.route('**/*',lambda route:route.continue_() if any(route.request.url.startswith(x) for x in allowed) else route.abort());ctx.route(base+'/api/**',route_api)
        # Candidate CSP is unchanged. Only the test-served HTML permits loopback emulators.
        def crm_html(route):
            html=(demo.PUBLIC/'crm-admin.html').read_text(encoding='utf-8')
            html=re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?>','',html,flags=re.I)
            bootstrap="window.AuthSessionGuard.ensureCompatFirebaseFromConfig=async f=>{if(!f.apps.length){f.initializeApp("+json.dumps(config)+");f.firestore().useEmulator('127.0.0.1',"+firestore.split(':')[1]+");f.auth().useEmulator('http://"+auth+"',{disableWarnings:true});}await window.AuthSessionGuard.ensureCompatLocalPersistence(f);await f.auth().signInWithEmailAndPassword("+json.dumps(email)+","+json.dumps(password)+");console.log('TEST_BOOTSTRAP',f.app().options.projectId,f.auth().currentUser?.uid);};"
            html=re.sub(r'(<script src="js/auth-session-guard.js[^>]+></script>)',lambda m:m[1]+'<script>'+bootstrap+'</script>',html)
            route.fulfill(content_type='text/html',body=html)
        ctx.route(base+'/crm-admin.html*',crm_html)
        page=ctx.new_page();diagnostics=[];page.on('console',lambda m:diagnostics.append(m.type+': '+m.text));page.on('pageerror',lambda e:diagnostics.append(str(e)));page.goto(base+'/__fixtures__/evaluator-host.html');page.evaluate('delete window.firebase')
        for module in ['app','auth','firestore']:
            page.add_script_tag(url=f'https://www.gstatic.com/firebasejs/9.22.0/firebase-{module}-compat.js')
        uid=page.evaluate("""async ({config,auth,firestore,email,password,create})=>{firebase.initializeApp(config);firebase.auth().useEmulator('http://'+auth,{disableWarnings:true});const [host,port]=firestore.split(':');firebase.firestore().useEmulator(host,Number(port));const result=create?await firebase.auth().createUserWithEmailAndPassword(email,password):await firebase.auth().signInWithEmailAndPassword(email,password);localStorage.setItem('crm_et_ui_rater_v1',JSON.stringify({id:'emulator-reviewer',name:'Emulator Reviewer'}));return result.user.uid;}""",{'config':config,'auth':auth,'firestore':firestore,'email':email,'password':password,'create':create})
        if create:
            url=f'http://{firestore}/v1/projects/{project}/databases/(default)/documents/users/{uid}'
            req=urllib.request.Request(url,data=json.dumps({'fields':{'isAdmin':{'booleanValue':True}}}).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer owner'},method='PATCH')
            with urllib.request.urlopen(req) as response:assert response.status==200
        response=page.goto(base+'/crm-admin.html#entrance-test-ui');assert 'TEST_BOOTSTRAP' in response.text(),'Emulator bootstrap route did not match'
        page.locator("[data-skin='d']").click()

        try:page.wait_for_function("document.querySelector('.et-annotation-toolbar button') && !document.querySelector('.et-annotation-toolbar button').disabled",timeout=45000)
        except Exception:
            page.screenshot(path=str(output/'emulator-error.png'),full_page=True)
            (output/'emulator-error.txt').write_text('\n'.join(diagnostics)+'\n'+page.locator('body').inner_text()[:15000]+'\n'+str(page.evaluate("({url:location.href,user:window.firebase?.auth?.().currentUser?.uid,apps:window.firebase?.apps?.map(a=>a.options),root:document.querySelector('#entrance-test-ui-root')?.innerHTML})")),encoding='utf-8')
            raise
        return ctx,page
    ctx,page=setup_context(True)
    page.get_by_role('button',name='Select region with keyboard',exact=True).click();frame=page.frame_locator('#et-ui-frame');picker=frame.get_by_role('dialog',name='Select region with keyboard');picker.get_by_label('Semantic target').select_option('intro/title');picker.get_by_label('Semantic target').press('Enter')
    dialog=page.locator('.et-annotation-dialog').filter(has=page.locator('textarea'));dialog.get_by_role('textbox').fill(body);dialog.get_by_role('button',name='Save',exact=True).click();dialog.wait_for(state='hidden')
    saved=page.evaluate("""async body=>{const s=await firebase.firestore().collection('entranceTestUiAnnotations/demo-d/items').where('body','==',body).get({source:'server'});return s.docs.map(d=>({id:d.id,version:d.data().version,createdAt:d.data().createdAt.toMillis(),uid:d.data().author.uid}));}""",body);assert len(saved)==1 and saved[0]['createdAt']>0
    ctx2,page2=setup_context(False);page2.get_by_role('button',name=re.compile(r'Feedback \(loaded')).click();page2.get_by_label('Feedback filter').select_option('all');page2.locator('.et-annotation-list article').filter(has_text=body).wait_for()
    row=page.locator('.et-annotation-list article').filter(has_text=body);page.get_by_role('button',name=re.compile(r'Feedback \(loaded')).click();page.get_by_label('Feedback filter').select_option('all');row.get_by_role('button',name='Delete',exact=True).click();page.get_by_role('dialog',name='Delete feedback',exact=True).get_by_role('button',name='Delete',exact=True).click()
    page.get_by_label('Feedback filter').select_option('deleted');row.get_by_role('button',name='Restore',exact=True).click()
    page.wait_for_function("""async id=>(await firebase.firestore().collection('entranceTestUiAnnotations/demo-d/items').doc(id).get({source:'server'})).data().version===3""",arg=saved[0]['id'])
    page.screenshot(path=str(output/'integrated-crm-emulator.png'),full_page=True)
    result={'scope':'Actual CRM candidate with real Auth and Firestore emulators; unrelated API reads stubbed','annotation':saved[0],'secondAuthenticatedContext':'pass','deleteRestoreVersion':3,'productionWrites':False}
    ctx2.close();ctx.close();return result

def run(output,emulators=False):
    server,base=demo.start_server();result={'scope':'Local Chrome; synthetic adapter; no production writes','cases':[],'geometry':[]}
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True,args=['--disable-features=LocalNetworkAccessChecks'])
            for dsf in [1,2]:
                ctx=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=dsf)
                page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                frame=prepare(page,base)
                page.locator('#et-ui-frame').scroll_into_view_if_needed()
                title=frame.locator('[data-et-annotation-id="intro/title"]');title.scroll_into_view_if_needed();r=title.bounding_box()
                page.get_by_role('button',name='Annotate',exact=True).click()
                # Ellipse gesture uses actual Chrome pointer events, not bridge injection.
                cx=r['x']+r['width']/2;cy=r['y']+r['height']/2;rx=r['width']*.4;ry=r['height']*.4
                page.mouse.move(cx+rx,cy);page.mouse.down()
                for i in range(1,41):
                    angle=i*2*math.pi/40;page.mouse.move(cx+rx*math.cos(angle),cy+ry*math.sin(angle))
                page.mouse.up()
                dialog=page.locator('.et-annotation-dialog').filter(has=page.locator('textarea'))
                dialog.wait_for(state='visible');dialog.get_by_role('textbox',name='Comment').fill('Tiếng Việt: sửa tiêu đề này.')
                dialog.get_by_role('button',name='Save',exact=True).click();dialog.wait_for(state='hidden')
                saved=page.evaluate("JSON.parse(localStorage.getItem('annotation-fixture-v1'))")
                assert len(saved)==1;id,item=next(iter(saved.items()));assert item['context']['view']=='intro'
                assert not page.get_by_label('Show marks').is_checked()
                page.get_by_role('button',name='Feedback (loaded 1)',exact=True).click()
                child=page.locator('#et-ui-frame').element_handle().content_frame()
                child.wait_for_selector('.et-annotation-overlay ellipse')
                page.get_by_role('button',name='Close feedback',exact=True).click()
                page.get_by_label('Show marks').check()
                child.wait_for_selector('.et-annotation-overlay ellipse')
                geometry=child.evaluate("""async item=>{const f=Object.values(item.anchor.fragments)[0],b=document.querySelector('[data-et-annotation-id=\"'+f.targetId+'\"]').getBoundingClientRect();const rect={left:b.left+f.rect.x0*b.width,right:b.left+f.rect.x1*b.width,top:b.top+f.rect.y0*b.height,bottom:b.top+f.rect.y1*b.height};const e=document.querySelector('.et-annotation-overlay ellipse');return {expected:{cx:(rect.left+rect.right)/2,cy:(rect.top+rect.bottom)/2},actual:{cx:Number(e.getAttribute('cx')),cy:Number(e.getAttribute('cy'))}};}""",item)
                drift=max(abs(geometry['expected'][k]-geometry['actual'][k]) for k in ['cx','cy']);assert drift<=3;result['geometry'].append({'dsf':dsf,'drift':drift,**geometry})
                page.get_by_role('button',name='Feedback (loaded 1)',exact=True).click()
                page.get_by_role('button',name='Edit',exact=True).click();dialog.get_by_role('textbox').fill('Unsaved retry text')
                page.evaluate('window.fixtureOffline=true');dialog.get_by_role('button',name='Save',exact=True).click();dialog.get_by_text('Offline: retry when connected').wait_for();assert dialog.get_by_role('textbox').input_value()=='Unsaved retry text'
                page.evaluate('window.fixtureOffline=false');dialog.get_by_role('button',name='Save',exact=True).click();dialog.wait_for(state='hidden')
                assert len(page.evaluate("JSON.parse(localStorage.getItem('annotation-fixture-v1'))"))==1
                page.get_by_role('button',name='Delete',exact=True).click();page.get_by_role('dialog',name='Delete feedback',exact=True).get_by_role('button',name='Delete',exact=True).click()
                page.get_by_label('Feedback filter').select_option('deleted');page.get_by_role('button',name='Restore',exact=True).click()
                page.get_by_label('Feedback filter').select_option('all');page.get_by_role('button',name='Open',exact=True).wait_for()
                other=ctx.new_page();prepare(other,base);other.get_by_role('button',name='Feedback (loaded 1)',exact=True).click();assert 'Unsaved retry text' in other.locator('.et-annotation-list').inner_text();other.close()
                page.get_by_role('button',name='Select region with keyboard',exact=True).click();picker=frame.get_by_role('dialog',name='Select region with keyboard');picker.get_by_label('Semantic target').select_option('intro/title');picker.get_by_label('Semantic target').press('Enter');dialog.get_by_role('textbox').fill('Keyboard feedback');dialog.get_by_role('button',name='Save',exact=True).click();dialog.wait_for(state='hidden')
                page.get_by_role('button',name='Select region with keyboard',exact=True).click();picker=frame.get_by_role('dialog',name='Select region with keyboard');picker.get_by_label('Semantic target').select_option('intro/title');picker.get_by_label('Semantic target').press('Enter');dialog.get_by_role('textbox').fill('Recoverable draft')
                dialog.get_by_role('textbox').dispatch_event('compositionstart');assert dialog.get_by_role('button',name='Save',exact=True).is_disabled();dialog.get_by_role('textbox').dispatch_event('compositionend')
                dialog.get_by_role('button',name='Cancel',exact=True).click();page.get_by_role('dialog',name='Discard unsaved feedback?').get_by_role('button',name='Keep editing').click();assert dialog.get_by_role('textbox').input_value()=='Recoverable draft'
                page.evaluate('window.fixtureSignOut()');assert dialog.get_by_role('button',name='Save',exact=True).is_disabled();assert dialog.get_by_role('textbox').input_value()=='Recoverable draft';assert page.locator('.et-annotation-list article').count()==0
                page.evaluate('window.fixtureSignIn()');assert dialog.get_by_role('button',name='Save',exact=True).is_disabled();dialog.get_by_role('button',name='Confirm reviewer',exact=True).click();assert not dialog.get_by_role('button',name='Save',exact=True).is_disabled()
                dialog.get_by_role('button',name='Cancel',exact=True).click();page.get_by_role('dialog',name='Discard unsaved feedback?').get_by_role('button',name='Discard',exact=True).click()
                before=child.evaluate("document.querySelector('[data-view]').dataset.view")
                page.evaluate("window.postMessage({type:'etui:page',skin:'d',revisionId:'academic-noto-v1',page:'done'},location.origin)")
                assert child.evaluate("document.querySelector('[data-view]').dataset.view")==before
                for width in [1024,768,390,320,1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    child.wait_for_function("document.querySelector('.et-annotation-overlay')?.getAttribute('viewBox') === `0 0 ${innerWidth} ${innerHeight}`")
                page.locator("[data-goto='vocab']").click()
                frame.locator('[data-question-id="vocab_q1"][data-view="question"]').wait_for()
                fallback=child.evaluate("""async()=>{const {captureRegion,absoluteRect,registry}=await import('/js/entrance-test-ui/annotation-anchors.js');const el=document.querySelector('.et-passage');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),selection={left:r.left+1,top:r.top+1,right:r.right-1,bottom:r.bottom-1};const a=captureRegion(selection);const f=Object.values(a.fragments)[0];return {count:Object.keys(a.fragments).length,kind:a.kind,selection,actual:absoluteRect(f.rect,registry().get(f.targetId).getBoundingClientRect()),targets:el.querySelectorAll('[data-et-annotation-id]').length};}""")
                assert fallback['targets']>=4 and fallback['count']==1 and fallback['kind']=='layout',fallback
                for k in ['left','top','right','bottom']:assert abs(fallback['selection'][k]-fallback['actual'][k])<=3,fallback
                result['cases'].append({'dsf':dsf,'four-plus-target-full-region-fallback':fallback})
                page.get_by_role('button',name='Close feedback',exact=True).click()
                frame.locator('[data-et-annotation-id="nav/question/vocab_q4"]').click()
                frame.locator('[data-view="question"][data-question-id="vocab_q4"]').wait_for()
                first=frame.locator('select[data-answer-blank]').first;first.select_option(index=1);answer=first.input_value()
                page.get_by_role('button',name='Select region with keyboard',exact=True).click();picker=frame.get_by_role('dialog',name='Select region with keyboard');picker.get_by_label('Semantic target').select_option('question/vocab_q4/passage');picker.get_by_label('Semantic target').press('Enter');dialog.get_by_role('textbox').fill('Exact question feedback');dialog.get_by_role('button',name='Save',exact=True).click();dialog.wait_for(state='hidden')
                page.locator('[data-goto="grammar"]').click();frame.locator('[data-view="question"][data-question-id="grammar_q1"]').wait_for()
                page.get_by_role('button',name='Feedback (loaded 3)',exact=True).click();page.get_by_label('Feedback filter').select_option('all');page.locator('.et-annotation-list article').filter(has_text='Exact question feedback').get_by_role('button',name='Open',exact=True).click();frame.locator('[data-view="question"][data-question-id="vocab_q4"]').wait_for();assert frame.locator('select[data-answer-blank]').first.input_value()==answer;dialog.get_by_role('button',name='Cancel',exact=True).click()
                page.get_by_role('button',name='Close feedback',exact=True).click()
                page.locator('[data-goto="speaking"]').click();frame.locator('[data-view="question"][data-question-id="speaking_q1"]').wait_for()
                text_item=child.evaluate("""async()=>{const {captureRegion}=await import('/js/entrance-test-ui/annotation-anchors.js');const el=document.querySelector('[data-et-text-run]');el.scrollIntoView({block:'center'});const r=document.createRange();r.setStart(el.firstChild,3);r.setEnd(el.firstChild,20);const b=r.getClientRects()[0];const anchor=captureRegion({left:b.left+.1,top:b.top+.1,right:b.right-.1,bottom:b.bottom-.1});return {context:{page:'speaking',view:'question',questionId:'speaking_q1',componentState:''},anchor};}""")
                assert list(text_item['anchor']['fragments'].values())[0]['kind']=='text'
                for width in [1024,768,390,320,1440]:
                    page.set_viewport_size({'width':width,'height':1000})
                    measured=child.evaluate("""async item=>{const {resolveRegion}=await import('/js/entrance-test-ui/annotation-anchors.js');const f=Object.values(item.anchor.fragments)[0],el=document.querySelector('[data-et-annotation-id="'+f.targetId+'"]');const r=document.createRange();r.setStart(el.firstChild,f.text.start);r.setEnd(el.firstChild,f.text.end);const expected=[...r.getClientRects()],actual=resolveRegion(item,item.context);return {reason:actual.reason,count:actual.rects.length,expectedCount:expected.length,drift:Math.max(...actual.rects.flatMap((b,i)=>['left','top','right','bottom'].map(k=>Math.abs(b[k]-expected[i][k]))))};}""",text_item)
                    assert not measured['reason'] and measured['count']==measured['expectedCount'] and measured['drift']<=3,measured
                    result['geometry'].append({'dsf':dsf,'width':width,'textRange':measured})
                cdp=ctx.new_cdp_session(page);cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':2});assert page.evaluate('visualViewport.scale')==2;cdp.send('Emulation.setPageScaleFactor',{'pageScaleFactor':1})
                for _ in range(3):page.evaluate('window.annotationFixture.destroy()');page.evaluate(SETUP)
                assert page.locator('.et-annotation-toolbar').count()==1 and child.locator('.et-annotation-overlay').count()==1
                result['cases'].append({'dsf':dsf,'dirty-modal-auth-recovery':'pass','IME-save-guard':'pass','exact-vocab-q4-answer-preservation':'pass','controller-remount':'pass'})
                page.screenshot(path=str(output/f'annotations-dsf-{dsf}.png'),full_page=True)
                assert not errors,errors
                result['cases'].append({'dsf':dsf,'drawing':'pass','save-edit-retry-delete-restore':'pass','second-page':'pass','keyboard':'pass','responsive-overlay':'pass','pageErrors':errors})
                ctx.close()
            if emulators:result['emulator']=emulator_case(browser,base,output)
            browser.close()
    finally:
        server.shutdown();server.server_close()
        (output/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--emulators',action='store_true');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True);run(args.output,args.emulators)
