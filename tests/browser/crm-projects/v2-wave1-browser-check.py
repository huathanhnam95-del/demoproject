"""Chrome-only, offline synthetic presentation check. Does not test authentication or persistence."""
import argparse
import hashlib
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from playwright.sync_api import sync_playwright


class ProjectsPanel(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts, self.depth = [], 0

    def handle_starttag(self, tag, attrs):
        if tag == 'section' and (self.depth or dict(attrs).get('data-panel') == 'projects'):
            self.depth += 1
        if self.depth:
            self.parts.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if self.depth:
            self.parts.append(f'</{tag}>')
            if tag == 'section':
                self.depth -= 1

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)

    def handle_entityref(self, name):
        if self.depth:
            self.parts.append(f'&{name};')

    def handle_charref(self, name):
        if self.depth:
            self.parts.append(f'&#{name};')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--baseline', action='store_true', help='Read original HTML/CSS/board/workspace from --base')
    parser.add_argument('--base', default='afa36b790951a84f07312ccf40968525bd637894')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    hashes = {}

    def source(relative):
        content = (subprocess.check_output(['git', 'show', f'{args.base}:{relative}'], cwd=root).decode('utf-8')
                   if args.baseline else (root / relative).read_text(encoding='utf-8'))
        hashes[relative] = hashlib.sha256(content.encode()).hexdigest()
        return content

    html = source('public/crm-admin.html')
    panel = ProjectsPanel()
    panel.feed(html)
    markup = ''.join(panel.parts)
    assert markup, 'Projects root missing'
    shell = source('public/crm-admin.js')
    bindings = dict(re.findall(r"elements\.(projects\w+) = document.getElementById\('([^']+)'\)", shell))
    styles = [source(p) for p in ['public/design-tokens.css', 'public/crm-admin.css', 'public/css/crm-projects.css']]
    scripts = [source(f'public/js/crm/projects/{name}.js') for name in ['state', 'presentation/detail-surface', 'board', 'workspace']]
    modes = [False] if args.baseline else [False, True]
    results, errors = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        try:
            for size in [30, 500, 5000]:
                data = json.loads(subprocess.check_output(['node', '-e', f"process.stdout.write(JSON.stringify(require('./tests/fixtures/crm/projects-v2').createFixture({size})))"], cwd=root))
                for enabled in modes:
                    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    # No remote fonts, APIs or customer data. The production panel/controllers are injected locally.
                    page.route('**/*', lambda route: route.abort())
                    page.set_content('<!doctype html><html><body>' + markup + '</body></html>')
                    for css in styles:
                        page.add_style_tag(content=css)
                    page.add_style_tag(content='[data-panel="projects"]{display:block!important;}')
                    for script in scripts:
                        page.add_script_tag(content=script)
                    if not args.baseline:
                        for name in ['field-feedback', 'entry']:
                            page.add_script_tag(content=source(f'public/js/crm/projects/presentation/{name}.js'))
                    page.evaluate('''({data, bindings, enabled, baseline}) => {
                        window.fixtureData = data;
                        const elements = Object.fromEntries(Object.entries(bindings).map(([key,id])=>[key,document.getElementById(id)]));
                        const uid = data.people[0].uid;
                        window.trace = []; window.feedbackEvents = []; window.holdSave = false;
                        let presentation;
                        const apiFetchJson = async (path, options) => {
                            const start = performance.now();
                            const url = new URL(path, 'http://fixture.invalid');
                            const projectId = url.pathname.split('/')[3];
                            const record = {path, method:options?.method || 'GET', start}; window.trace.push(record);
                            if (options) {
                                const body = JSON.parse(options.body); record.body = body;
                                if (window.holdSave) await new Promise(resolve=>{window.releaseSave=resolve;});
                                const task = data.tasks.find(t=>t.id===url.pathname.split('/').pop());
                                if (window.failSave) throw Object.assign(new Error('Synthetic rejected mutation'), {status:409});
                                if (!task || body.expectedRevision !== task.revision) throw Object.assign(new Error('Revision conflict'), {status:409});
                                Object.assign(task, Object.fromEntries(Object.entries(body).filter(([k])=>!['operationId','expectedRevision'].includes(k))));
                                task.revision++; record.end=performance.now(); return {task:{...task}};
                            }
                            if (path.includes('/member-directory')) return {people:data.people.filter(p=>p.role)};
                            if (url.pathname.endsWith('/tasks')) {
                                const filters = JSON.parse(url.searchParams.get('filters')||'{}');
                                const active = data.tasks.filter(t=>t.lifecycle==='active' && !t.ancestorIds.includes('t5') && (t.parentTaskId||null)===(filters.parentTaskId||null));
                                const offset = Number(url.searchParams.get('cursor')||0), tasks = active.slice(offset,offset+100);
                                return {tasks:structuredClone(tasks),sections:data.sections,columns:data.columns,revision:{schemaRevision:1,structureRevision:1},nextCursor:offset+100<active.length?String(offset+100):null};
                            }
                            return {project:data.projects.find(p=>p.id===projectId),membership:{role:'Owner'}};
                        };
                        window.board = CrmProjectsBoard.createController({elements,apiFetchJson,getCurrentUser:()=>({uid}),
                            onFieldSaveEvent:event=>{feedbackEvents.push({...event,time:performance.now()});presentation?.onFieldSaveEvent?.(event);},
                            onFieldSaveScopeChanged:scope=>presentation?.setFieldSaveScope?.(scope),
                            onContextChanged:snapshot=>presentation?.setContext?.(snapshot)});
                        const createWorkspace=()=>CrmProjectsWorkspace.createController({getCurrentUser:()=>({uid})});
                        presentation=baseline?createWorkspace():CrmProjectsPresentationV2.createController({config:{projectsV2:enabled},panel:document.querySelector('[data-panel="projects"]'),createWorkspace});
                        window.presentation=presentation;
                        board.init(); presentation.init();
                        const selection={projects:data.projects,selectedProjectId:'v2-a'};
                        presentation.setSelection(selection); board.setProjects(selection);
                    }''', {'data': data, 'bindings': bindings, 'enabled': enabled, 'baseline': args.baseline})
                    page.wait_for_function('board.getState().authorizationReady')
                    page.wait_for_load_state('networkidle')
                    assert page.locator('.projects-v2').count() == int(enabled)
                    rows = page.locator('[data-row-kind="task"]').count()
                    assert 0 < rows < 120, f'Unbounded rendered rows: {rows}'
                    widths = [390, 700, 980, 1280, 1600] if size == 30 else [1280]
                    container_widths = []
                    for width in widths:
                        page.set_viewport_size({'width': width, 'height': 1000})
                        actual = page.locator('[data-panel="projects"]').evaluate('''(el,width)=>{
                            el.style.width=(width/(parseFloat(getComputedStyle(el).zoom)||1))+"px";
                            return el.getBoundingClientRect().width;
                        }''', width)
                        assert abs(actual-width) < 2, f'Expected actual container width {width}, got {actual}'
                        container_widths.append(actual)
                        page.screenshot(path=str(out / f'{size}-{enabled}-{width}.png'), full_page=True)
                    if size == 30:
                        page.set_viewport_size({'width':1600,'height':1000})
                        page.locator('[data-panel="projects"]').evaluate('''el=>{
                            const zoom=parseFloat(getComputedStyle(el).zoom)||1;
                            el.style.width=(1280/zoom)+"px";el.style.marginLeft=(280/zoom)+"px";
                        }''')
                        page.screenshot(path=str(out / f'{size}-{enabled}-wide-with-nav-space.png'), full_page=True)
                    page.evaluate('board.selectTask(board.getSnapshot().tasks.get("t0"))')
                    page.wait_for_function('!document.getElementById("projects-board-detail").hidden')
                    drawer_open = page.locator('#projects-board-detail').evaluate('(el)=>({open:el.open,hidden:el.hidden})')
                    page.evaluate('presentation.closeForNavigation()')
                    page.wait_for_function('document.getElementById("projects-board-detail").hidden')
                    before_reads = page.evaluate('trace.filter(t=>t.method==="GET").length')
                    page.evaluate('''() => { window.holdSave=true; window.editStart=performance.now(); window.savePromise=board.saveTaskField('t0','title',{value:'Bản nháp đã chỉnh sửa',dataset:{}}); }''')
                    page.wait_for_function('typeof releaseSave === "function"')
                    if not args.baseline:
                        assert page.evaluate('feedbackEvents.at(-1).phase') == 'saving'
                        assert not page.evaluate('feedbackEvents.some(e=>e.phase==="saved")')
                    page.screenshot(path=str(out / f'{size}-{enabled}-saving.png'), full_page=True)
                    page.evaluate('releaseSave(); window.holdSave=false')
                    page.evaluate('savePromise')
                    if not args.baseline:
                        assert page.evaluate('feedbackEvents.at(-1).phase') == 'saved'
                        if enabled:
                            assert page.evaluate('presentation.feedback.get("t0","title").phase') == 'saved'
                    after_reads = page.evaluate('trace.filter(t=>t.method==="GET").length')
                    assert after_reads == before_reads, 'Cell save introduced a project read'
                    metrics = page.evaluate('''() => ({events:feedbackEvents,trace,loaded:board.getState().tasks.size,saveDuration:performance.now()-editStart})''')
                    results.append({'size':size,'v2':enabled,'actualContainerWidths':container_widths,'renderedRows':rows,'drawer':drawer_open,'readsPerEdit':after_reads-before_reads,**metrics})
                    page.evaluate('presentation.dispose()')
                    assert page.locator('.projects-v2').count() == 0
                    page.close()
        finally:
            browser.close()
    report = {'baseline':args.baseline,'sourceSha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
              'baseSha':args.base,'hashes':hashes,'browser':'installed Google Chrome','boundary':'Offline synthetic panel; no login, emulator, persisted data or production verification',
              'results':results,'pageErrors':errors}
    (out / 'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    assert not errors, errors
    print(f'PASS: {len(results)} Chrome fixture runs; screenshots and metrics: {out}')


if __name__ == '__main__':
    main()
