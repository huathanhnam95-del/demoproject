"""Bounded installed-Chrome checks; no video, trace, or frame files are created."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def run(headed=False):
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=not headed)
        for reduced in ['no-preference', 'reduce']:
            page = browser.new_page(viewport={'width': 390, 'height': 844}, reduced_motion=reduced)
            page.set_content('''<button id="opener">Open</button><main id="region" style="height:180px">Existing rows</main>
              <div id="dialog" class="crm-modal-overlay" aria-hidden="true" style="display:none">
              <div class="crm-modal-container"><button id="close">Close</button><input id="field"></div></div>''')
            page.add_style_tag(path=str(ROOT/'public/crm-admin.css'))
            page.add_style_tag(path=str(ROOT/'public/css/ui-continuity.css'))
            page.add_script_tag(path=str(ROOT/'public/js/ui-continuity.js'))
            outcome = page.evaluate('''() => {
              const region = document.getElementById('region');
              const before = region.getBoundingClientRect().height;
              const first = UIContinuity.begin('list', {region, message:'Loading students…'});
              const busy = region.getAttribute('aria-busy');
              const second = UIContinuity.begin('list', {region, message:'Refreshing students…'});
              first.finish();
              const latestPreserved = second.isCurrent() && region.getAttribute('aria-busy') === 'true';
              const stable = region.getBoundingClientRect().height === before;
              second.finish();
              return {busy, latestPreserved, stable, restored:!region.hasAttribute('aria-busy'),
                feedbackRemoved:!document.querySelector('.ui-task-feedback')};
            }''')
            assert outcome == dict(busy='true', latestPreserved=True, stable=True, restored=True, feedbackRemoved=True), outcome
            page.locator('#opener').focus()
            page.evaluate("let d=document.getElementById('dialog');d.style.display='flex';d.setAttribute('aria-hidden','false')")
            page.wait_for_function("document.activeElement.id === 'close'")
            page.locator('#field').focus()
            page.keyboard.press('Tab')
            assert page.evaluate('document.activeElement.id') == 'close'
            page.evaluate("let d=document.getElementById('dialog');d.style.display='none';d.setAttribute('aria-hidden','true')")
            page.wait_for_function("document.activeElement.id === 'opener'")
            page.evaluate("let d=document.getElementById('dialog');d.style.display='flex';d.setAttribute('aria-hidden','false')")
            page.wait_for_function("document.activeElement.id === 'close'")
            assert page.locator('#dialog').evaluate('(e)=>!e.inert')
            page.evaluate("document.getElementById('dialog').style.display='none'")
            page.wait_for_function("document.activeElement.id === 'opener'")
            # Existing controllers can focus before the mutation observer runs.
            page.evaluate("let d=document.getElementById('dialog');d.style.display='flex';document.getElementById('field').focus()")
            page.wait_for_function("document.getElementById('dialog').dataset.uiOpen === 'true'")
            page.evaluate("document.getElementById('dialog').style.display='none'")
            page.wait_for_function("document.activeElement.id === 'opener'")
            results.append({'motion':reduced,'pending':outcome,'dialogFocusAndReversal':'pass'})
            page.close()

        page = browser.new_page(viewport={'width':1440,'height':900})
        html = (ROOT/'public/crm-admin.html').read_text(encoding='utf-8')
        header = re.search(r'<header class="crm-header">[\s\S]*?</header>',html).group()
        shell = (ROOT/'public/crm-admin.js').read_text(encoding='utf-8')
        dropdown = re.search(r'\(function initNavDropdowns\(\) \{[\s\S]*?\n  \}\)\(\);',shell).group()
        page.set_content(f'<div class="crm-admin">{header}</div><main>Content</main>')
        page.add_style_tag(path=str(ROOT/'public/crm-admin.css'))
        page.add_script_tag(content=dropdown)
        trigger=page.locator('.crm-nav-more-dropdown > .crm-nav-item')
        trigger.click()
        assert trigger.get_attribute('aria-expanded') == 'true'
        page.keyboard.press('Escape')
        assert trigger.get_attribute('aria-expanded') == 'false'
        assert trigger.evaluate('(e)=>document.activeElement===e')
        results.append({'dropdownKeyboard':'pass'})

        page.set_content('<main id="students" style="min-height:200px">Existing students</main>')
        page.add_style_tag(path=str(ROOT/'public/css/ui-continuity.css'))
        page.add_script_tag(path=str(ROOT/'public/js/ui-continuity.js'))
        page.add_script_tag(path=str(ROOT/'public/js/crm/student-directory-workspace.js'))
        result=page.evaluate('''async () => {
          const pending=[]; const dataCache={students:[]};
          const controller=CrmStudentDirectoryWorkspace.createController({
            elements:{studentsContainer:document.getElementById('students')},dataCache,
            apiFetchJson:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
            populateAttendanceStudentOptions:async()=>{},openStudentProfile:async()=>{},showToast:()=>{},
            getReminderSummary:()=>({}),renderReminderBadgeMarkup:()=>'',renderRiskBadgeMarkup:()=>'',
            escapeHtml:(s)=>String(s??''),formatDateTime:()=>''
          });
          const a=controller.refreshStudentLists(); const b=controller.refreshStudentLists();
          const acknowledged=document.getElementById('students').getAttribute('aria-busy')==='true';
          pending[1].resolve({students:[{studentId:'new',name:'New response'}]});await b;
          pending[0].resolve({students:[{studentId:'old',name:'Old response'}]});await a;
          const latestWins=dataCache.students[0].studentId==='new' && document.body.innerText.includes('New response');
          const failed=controller.refreshStudentLists(); pending[2].reject(new Error('Offline'));await failed.catch(()=>{});
          return {acknowledged,latestWins,retainedOnFailure:document.body.innerText.includes('New response'),
            busyCleared:document.getElementById('students').getAttribute('aria-busy')!=='true'};
        }''')
        assert all(result.values()),result
        results.append({'studentRequestOrdering':result})
        page.set_content('<main id="teachers">Previous teachers</main><main id="accounts">Previous accounts</main>')
        page.add_script_tag(path=str(ROOT/'public/js/ui-continuity.js'))
        page.add_script_tag(path=str(ROOT/'public/js/crm/staff-workspace.js'))
        staff = page.evaluate('''async () => {
          const pending=[];
          const controller=CrmStaffWorkspace.createController({
            elements:{staffTeacherList:document.getElementById('teachers'),staffAccountList:document.getElementById('accounts')},
            apiFetchJson:(path)=>new Promise((resolve,reject)=>pending.push({path,resolve,reject})),
            getCurrentUser:()=>({uid:'self'}),showToast:()=>{}
          });
          const a=controller.refresh(),b=controller.refresh();
          const acknowledged=document.getElementById('teachers').getAttribute('aria-busy')==='true';
          const payload=(label)=>({teachers:[{uid:label,displayName:label}],accounts:[{uid:label,displayName:label}]});
          pending[2].resolve(payload('new'));pending[3].resolve(payload('new'));await b;
          pending[0].resolve(payload('old'));pending[1].resolve(payload('old'));await a;
          const latestWins=['teachers','accounts'].every(id=>document.getElementById(id).innerText.includes('new'));
          const c=controller.refresh();pending[4].reject(new Error('Offline'));pending[5].reject(new Error('Offline'));await c;
          return {acknowledged,latestWins,retainedOnFailure:['teachers','accounts'].every(id=>document.getElementById(id).innerText.includes('new')),
            busyCleared:['teachers','accounts'].every(id=>document.getElementById(id).getAttribute('aria-busy')!=='true')};
        }''')
        assert all(staff.values()),staff
        results.append({'staffRefreshOrderingAndFailure':staff})
        page.set_content('<section class="crm-panel" data-panel="courses/teacher-schedule" style="display:none">Schedule</section>')
        page.add_style_tag(path=str(ROOT/'public/crm-admin.css'))
        panel=page.locator('[data-panel]')
        assert panel.evaluate("e=>getComputedStyle(e).display") == 'none', 'Router-hidden schedule must stay hidden'
        panel.evaluate("e=>e.style.display='block'")
        assert panel.evaluate("e=>getComputedStyle(e).display") == 'flex', 'Active schedule must retain its flex layout'
        results.append({'teacherScheduleVisibility':'pass'})
        browser.close()
    return results


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--headed',action='store_true')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    summary={'status':'pass','evidenceClass':'isolated real-Chrome DOM fixtures','checks':run(args.headed)}
    if args.output:
        args.output.write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary))
