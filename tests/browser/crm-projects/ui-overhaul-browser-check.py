"""Chrome acceptance for the shipped Projects shell on an isolated emulator host.
Start the review fixture server, then pass --url, --project-id and --artifacts.
Uses .local/browser-test-credentials.md; never writes credentials or auth storage.
"""
import argparse, asyncio, json, pathlib, re, uuid
from playwright.async_api import async_playwright

async def main(args):
    out = pathlib.Path(args.artifacts); out.mkdir(parents=True, exist_ok=True)
    creds = pathlib.Path(args.credentials).read_text(encoding='utf-8')
    email = re.search(r'Username: `([^`]+)`', creds)[1]
    password = re.search(r'Password: `([^`]+)`', creds)[1]
    results = []; errors = []; title_value = 'Chrome acceptance ' + uuid.uuid4().hex[:8]
    def check(name, ok, actual=None):
        results.append({'name': name, 'passed': bool(ok), 'actual': actual})
        (out / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
    async def idle(page):
        await page.wait_for_function('()=>document.querySelector("[data-task-id=t1][data-row-kind=task]") && document.querySelector("#projects-board-section").getAttribute("aria-busy")==="false"')
    async def hold(page, method='GET'):
        reached, release = asyncio.Event(), asyncio.Event()
        pattern = f'**/api/projects/{args.project_id}/tasks' + ('?*' if method == 'GET' else '')
        async def route_handler(route):
            if route.request.method == method:
                reached.set(); await release.wait()
            await route.continue_()
        await page.route(pattern, route_handler)
        return reached, release, pattern, route_handler
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel='chrome', headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = await context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
        reached, release, pattern, handler = await hold(page)
        await page.goto(args.url + '/review-login', wait_until='networkidle')
        await page.locator('#email').fill(email); await page.locator('#password').fill(password)
        await page.get_by_role('button', name='Sign in').click()
        await asyncio.wait_for(reached.wait(), 30)
        visible = await page.locator('#projects-board-initial-loading').is_visible()
        check('Safe initial skeleton is visible before task response', visible)
        await page.screenshot(path=str(out / 'initial-loading.png')); release.set(); await idle(page); await page.unroute(pattern, handler)
        try: await page.wait_for_load_state('networkidle', timeout=2500)
        except Exception: pass  # Serialized change polling may keep the network active.
        status = page.locator('[data-task-id=t1][data-row-kind=task] [data-field-kind=status]')
        style = await status.evaluate('e=>({radius:getComputedStyle(e).borderRadius,height:e.getBoundingClientRect().height,padding:getComputedStyle(e).paddingLeft})')
        check('Labelled status is an inset pill', float(style['radius'].removesuffix('px')) >= 14 and style['height'] <= 32, style)
        header_top = (await page.locator('#projects-board-header').bounding_box())['y']
        check('Compact desktop header is below 320px', header_top < 320, header_top)
        sections = await page.locator('[data-row-kind=section]').evaluate_all('es=>es.map(e=>({id:e.dataset.sectionId,top:e.getBoundingClientRect().top,position:getComputedStyle(e).position}))')
        check('Virtual section headings use positioned tracks', all(e['position'] == 'absolute' for e in sections), sections)
        check('Dates offer deliberate set-date controls', await page.locator('.crm-board-date-trigger').count() >= 2)
        await page.screenshot(path=str(out / 'desktop.png'))
        reached, release, pattern, handler = await hold(page)
        await page.locator('#btn-projects-board-refresh').click(); await asyncio.wait_for(reached.wait(), 15)
        await page.wait_for_function('()=>document.querySelector("#projects-board-table-wrap").classList.contains("is-loading")')
        selection = page.locator('[data-task-id=t2][data-row-kind=task] [data-action=select-task]')
        box = await selection.bounding_box(); await page.mouse.click(box['x'] + 5, box['y'] + 5)
        check('Retained rows are selectable while writes revalidate', await selection.is_checked())
        refresh = await page.locator('#projects-board-table-wrap').evaluate('e=>({position:getComputedStyle(e).position,rowOpacity:getComputedStyle(e.querySelector("[data-row-kind=task]")).opacity,top:getComputedStyle(e,"::before").top})')
        check('Refresh indicator is anchored to readable board', refresh['position'] == 'relative' and refresh['rowOpacity'] == '1', refresh)
        await page.screenshot(path=str(out / 'refresh.png')); release.set(); await idle(page); await page.unroute(pattern, handler)
        if await selection.is_checked(): await selection.uncheck()
        reached, release, pattern, handler = await hold(page, 'POST')
        count = await page.locator('[data-row-kind=task]').count()
        await page.locator('#btn-projects-board-add-task').click(); await asyncio.wait_for(reached.wait(), 10)
        pending = {'disabled': await page.locator('#btn-projects-board-add-task').is_disabled(), 'text': await page.locator('#btn-projects-board-add-task').inner_text()}
        check('Creation gives immediate pending feedback', pending['disabled'] and 'Creating' in pending['text'], pending)
        await page.screenshot(path=str(out / 'creation-pending.png')); release.set()
        await page.wait_for_function('(n)=>document.querySelectorAll("[data-row-kind=task]").length>n', arg=count)
        await page.wait_for_function('()=>!document.querySelector(".crm-projects-board-row.is-new")')
        focus = await page.evaluate('()=>({tag:document.activeElement.tagName,field:document.activeElement.dataset.fieldKind,dialog:document.querySelector("#projects-board-detail").open})')
        check('Acknowledgement focuses title and keeps details closed', focus.get('field') == 'title' and not focus['dialog'], focus)
        await page.unroute(pattern, handler)
        if not focus['dialog']:
            title = page.locator('[data-row-kind=task] [data-field-kind=title]:focus')
            created_id = await title.evaluate('e=>e.closest("[data-task-id]").dataset.taskId')
            await title.fill(title_value)
            async with page.expect_response(lambda r: '/tasks/' in r.url and r.request.method == 'PATCH') as saved: await title.press('Tab')
            check('New title saves through real API', (await saved.value).status == 200)
        else: await page.locator('#btn-projects-board-close-detail').click()
        await page.reload(wait_until='domcontentloaded'); await idle(page)
        check('Exactly one created row survives reload', await page.locator('[data-row-kind=task]').count() == count + 1)
        if focus.get('field') == 'title':
            check('New title persists', await page.locator(f'[data-row-kind=task][data-task-id="{created_id}"] [data-field-kind=title]').input_value() == title_value)
        # Date labels use the actual picker and original field change/save path.
        date_button = page.locator('[data-task-id=t2][data-row-kind=task] .crm-board-date-trigger').first
        await date_button.click(); await page.locator('.crm-datepick').wait_for(state='visible')
        async with page.expect_response(lambda r: '/tasks/t2' in r.url and r.request.method == 'PATCH') as date_saved:
            await page.locator('[data-datepick-today]').click()
        check('Date action saves through the real API', (await date_saved.value).status == 200)
        date_value = await page.locator('[data-task-id=t2][data-row-kind=task] [data-field-kind=startDate]').input_value()
        await page.reload(wait_until='domcontentloaded'); await idle(page)
        check('Date value survives reload', bool(date_value) and await page.locator('[data-task-id=t2][data-row-kind=task] [data-field-kind=startDate]').input_value() == date_value)
        await date_button.click(); await page.keyboard.press('Escape')
        check('Date picker Escape returns focus to its visible trigger', await date_button.evaluate('e=>e===document.activeElement'))
        # A second real browser page makes an ordinary remote edit while this draft stays unsent.
        peer = await context.new_page(); await peer.goto(args.url + '/crm-admin.html#projects', wait_until='domcontentloaded'); await idle(peer)
        draft = page.locator('[data-task-id=t2][data-row-kind=task] [data-field-kind=title]')
        await draft.fill('Unsent acceptance draft'); await draft.evaluate('e=>e.setSelectionRange(3,9)')
        remote = peer.locator('[data-task-id=t3][data-row-kind=task] [data-field-kind=title]')
        remote_value = 'Remote ' + uuid.uuid4().hex[:8]; await remote.fill(remote_value); await remote.press('Tab')
        await page.wait_for_function('(value)=>document.querySelector("[data-task-id=t3][data-row-kind=task] [data-field-kind=title]").value===value', arg=remote_value, timeout=20000)
        retained = await draft.evaluate('e=>({value:e.value,focused:e===document.activeElement,start:e.selectionStart,end:e.selectionEnd})')
        check('Remote update preserves exact draft and caret', retained == {'value':'Unsent acceptance draft','focused':True,'start':3,'end':9}, retained)
        await peer.close(); await page.reload(wait_until='domcontentloaded'); await idle(page)
        async def fail_create(route):
            if route.request.method == 'POST': await route.fulfill(status=500, content_type='application/json', body=json.dumps({'success':False,'error':'ACCEPTANCE_FAILURE','message':'Acceptance create failure'}))
            else: await route.continue_()
        failed_pattern = f'**/api/projects/{args.project_id}/tasks'; await page.route(failed_pattern, fail_create)
        before_failure = await page.locator('[data-row-kind=task]').count()
        await page.locator('#btn-projects-board-add-task').click(); await page.get_by_text('Acceptance create failure', exact=True).wait_for()
        check('Failed create leaves no phantom row and permits retry', await page.locator('[data-row-kind=task]').count() == before_failure and await page.locator('#btn-projects-board-add-task').is_enabled())
        await page.unroute(failed_pattern, fail_create)
        await page.get_by_text('Acceptance create failure', exact=True).wait_for(state='hidden', timeout=10000)
        await page.emulate_media(reduced_motion='reduce')
        reached, release, pattern, handler = await hold(page)
        await page.locator('#btn-projects-board-refresh').click(); await asyncio.wait_for(reached.wait(), 15)
        animation = await page.locator('#projects-board-table-wrap').evaluate('e=>getComputedStyle(e,"::before").animationName')
        check('Reduced motion disables the active loading animation', animation == 'none', animation)
        release.set(); await idle(page); await page.unroute(pattern, handler)
        row = page.locator('[data-task-id=t2][data-row-kind=task]'); await row.focus(); await row.press('Enter')
        await page.locator('#btn-projects-board-close-detail').wait_for(state='visible'); await page.screenshot(path=str(out / 'details.png'))
        await page.locator('#btn-projects-board-close-detail').click()
        check('Explicit detail close restores row focus', await row.evaluate('e=>e===document.activeElement || e.contains(document.activeElement)'))
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_function('()=>document.querySelector("#crm-nav").getBoundingClientRect().right<=1')
        mobile_top = (await page.locator('#projects-board-header').bounding_box())['y']
        check('Mobile task header is below 440px', mobile_top < 440, mobile_top)
        toolbar = await page.locator('.crm-projects-workspace-heading-actions').evaluate('e=>Array.from(e.children).filter(c=>c.getClientRects().length).every(c=>c.getBoundingClientRect().right<=e.getBoundingClientRect().right+1)')
        check('Mobile heading actions fit without clipping', toolbar)
        check('Mobile main canvas avoids outer overflow', await page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth'))
        await page.screenshot(path=str(out / 'mobile.png'))
        await browser.close()
    check('No page exceptions', not errors, errors)
    (out / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    if any(not result['passed'] for result in results): raise SystemExit(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True); parser.add_argument('--project-id', required=True)
    parser.add_argument('--artifacts', required=True)
    parser.add_argument('--credentials', default=r'C:\Cursor AI\.local\browser-test-credentials.md')
    asyncio.run(main(parser.parse_args()))
