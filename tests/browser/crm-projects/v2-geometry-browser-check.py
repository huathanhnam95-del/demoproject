"""PR04 Chrome geometry/reconciliation checks using the production shell fixture."""
import argparse
import runpy
import sys
from pathlib import Path


def check_row_order(page):
    """Native Tab must follow logical rows after structural and viewport changes."""
    scroll = page.locator('#projects-board-scroll')

    def ordered():
        rows = page.locator('#projects-board-rows > [data-row-id]').evaluate_all(
            'rows=>rows.map(r=>({id:r.dataset.rowId,index:Number(r.getAttribute("aria-rowindex"))}))')
        indices = [row['index'] for row in rows]
        assert indices == sorted(indices), ('DOM order', rows)
        assert len({row['id'] for row in rows}) == len(rows) < 80
        return rows

    def tab_to_next(task, next_task):
        page.locator(f'[data-task-id="{task}"] .crm-board-field:not(:disabled)').last.focus()
        page.keyboard.press('Tab')
        assert page.evaluate('document.activeElement.closest("[data-task-id]")?.dataset.taskId') == next_task, ('Tab', task, next_task)

    page.locator('[data-task-id="t7"] [data-action="select-task"]').check()
    page.locator('[data-task-id="t7"] input[data-column-id="c-text"]').evaluate('''e=>{
        window.orderEditor=e;window.orderRow=e.closest('[data-row-id]');
        e.focus();e.value='Order draft';e.setSelectionRange(2,7,'backward');
        e.dispatchEvent(new Event('input',{bubbles:true}));
    }''')
    page.evaluate('board.updateTask({...board.getState().tasks.get("t7"),rank:"-1/1",revision:2})')
    assert page.evaluate('document.activeElement===orderEditor && orderEditor.isConnected && orderEditor.value==="Order draft" && orderEditor.selectionStart===2 && orderEditor.selectionEnd===7 && orderEditor.selectionDirection==="backward"')
    assert page.locator('[data-task-id="t7"]').evaluate('e=>e===orderRow')
    assert page.locator('[data-task-id="t7"] [data-action="select-task"]').is_checked()
    # Assert real Tab independently before checking DOM order (the original bug skips t0).
    tab_to_next('t7', 't0')
    rank_rows = ordered()
    page.locator('[data-task-id="t0"] [data-action="toggle-task"]').click()
    page.wait_for_selector('[data-task-id="t1"]')
    branch_rows = ordered()
    tab_to_next('t0', 't1')
    # Scroll backward over a partially retained window with an editor still pinned.
    scroll.evaluate('e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"));}')
    page.locator('#projects-board-rows [data-row-kind="task"] input[data-column-id="c-text"]').last.evaluate('e=>{window.reverseEditor=e;e.focus();}')
    scroll.evaluate('e=>{e.scrollTop=Math.max(0,e.scrollTop-264);e.dispatchEvent(new Event("scroll"));}')
    reverse_rows = ordered()
    assert page.evaluate('document.activeElement===reverseEditor && reverseEditor.isConnected')
    visible_tasks = page.locator('#projects-board-rows > [data-row-kind="task"]').evaluate_all('''rows=>rows.filter(r=>{
        const box=r.getBoundingClientRect(),s=document.getElementById('projects-board-scroll').getBoundingClientRect();
        return box.top>=document.getElementById('projects-board-header').getBoundingClientRect().bottom && box.bottom<=s.bottom;
    }).map(r=>r.dataset.taskId)''')
    assert len(visible_tasks) >= 2
    tab_to_next(visible_tasks[0], visible_tasks[1])
    # An offscreen pin after the visible window must also retain logical DOM order.
    page.evaluate('reverseEditor.focus({preventScroll:true})')
    scroll.evaluate('e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));}')
    pinned_rows = ordered()
    assert page.evaluate('document.activeElement===reverseEditor && reverseEditor.isConnected')
    page.locator('#projects-workspace-name').evaluate('e=>{e.tabIndex=-1;e.focus();}')
    page.locator('[data-task-id="t0"] [data-action="toggle-task"]').click()
    page.evaluate('board.updateTask({...board.getState().tasks.get("t7"),rank:"7/1",revision:3})')
    scroll.evaluate('e=>{e.scrollTop=0;e.scrollLeft=0;e.dispatchEvent(new Event("scroll"));}')
    page.locator('[data-task-id="t7"] [data-action="select-task"]').uncheck()
    assert page.evaluate('calls.every(c=>c.method==="GET")')
    return {'rank': rank_rows, 'branch': branch_rows, 'reverse': reverse_rows, 'pinned': pinned_rows, 'nativeTab': True}


def check(page, enabled, stored, out, size):
    scroll = page.locator('#projects-board-scroll')
    if not enabled:
        assert scroll.evaluate('e=>e.parentNode.id') == 'projects-board-table'
        assert page.locator('#projects-v2-columns').count() == 0
        assert page.locator('#projects-board-header [data-column-key]').count() == 0
        return {'size': size, 'v2': False, 'legacy': stored, 'legacyTopology': True}
    assert scroll.evaluate('e=>e.parentNode.id') == 'projects-board-table-wrap'
    assert page.locator('#projects-board-table').evaluate('e=>e.parentNode.id') == 'projects-board-scroll'
    assert page.locator('#projects-board-rows').evaluate('e=>e.parentNode.id') == 'projects-board-table'
    order_result = check_row_order(page)
    # Load the existing lazy branch through its actual expander, never flatten eagerly.
    if size > 100:
        assert not page.evaluate('calls.some(c=>c.url.includes("/tasks?") && JSON.parse(new URL(c.url,"https://fixture.invalid").searchParams.get("filters")||"{}").parentTaskId==="t4")')
        page.locator('[data-task-id="t4"] [data-action="toggle-task"]').click()
        page.wait_for_timeout(200)
        print('lazy-diagnostic', size, page.evaluate('({tasks:board.getState().tasks.size,calls:calls.filter(c=>c.url.includes("/tasks?")).map(c=>decodeURIComponent(c.url))})'), flush=True)
        page.wait_for_function('(n)=>board.getState().tasks.size>=n-6', arg=size)
        assert page.evaluate('calls.filter(c=>c.url.includes("/tasks?") && JSON.parse(new URL(c.url,"https://fixture.invalid").searchParams.get("filters")||"{}").parentTaskId==="t4").length') == 1
    # Original editor/caret survives canonical reorder and another column disappearing.
    page.locator('[data-task-id="t0"] input[data-column-id="c-text"]').evaluate('e=>{window.retainedEditor=e;e.focus();e.value="Draft kept";e.setSelectionRange(2,5);e.dispatchEvent(new Event("input",{bubbles:true}));}')
    page.evaluate('board.setColumnPreferences({order:["custom:c-text","dates","status","ownerUid"],hidden:["assigneeUids"],widths:{"custom:c-text":240}})')
    assert page.evaluate('document.activeElement===retainedEditor && retainedEditor.selectionStart===2 && retainedEditor.value==="Draft kept"')
    assert page.locator('[data-task-id="t0"] > [data-column-key]').evaluate_all('cells=>cells.map(c=>c.dataset.columnKey)') == page.locator('#projects-board-header > [data-column-key]').evaluate_all('cells=>cells.map(c=>c.dataset.columnKey)')
    # Focused row stays mounted across a distant scroll; blur does not save this draft.
    scroll.evaluate('e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(50)
    assert page.evaluate('retainedEditor.isConnected && document.activeElement===retainedEditor')
    assert page.locator('#projects-board-rows > [data-row-id]').count() < 80
    assert page.evaluate('calls.every(c=>c.method==="GET")')
    page.locator('#projects-workspace-name').evaluate('e=>{e.tabIndex=-1;e.focus();}')
    page.evaluate('board.setColumnPreferences({})')
    scroll.evaluate('e=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(50)
    page.locator('[data-task-id="t4"]').evaluate('e=>{window.draggedRow=e;e.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:new DataTransfer()}));}')
    scroll.evaluate('e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(50)
    assert page.evaluate('draggedRow.isConnected'), 'drag source retained beyond viewport'
    assert page.locator('#projects-board-rows > [data-row-id]').count() < 80
    page.evaluate('draggedRow.dispatchEvent(new DragEvent("dragend",{bubbles:true,dataTransfer:new DataTransfer()}))')
    widths = []
    for width in [390, 700, 980, 1280, 1600]:
        page.locator('[data-panel="projects"]').evaluate('(e,w)=>e.style.width=w+"px"', width)
        page.wait_for_function('(w)=>Math.abs(document.querySelector("[data-panel=projects]").getBoundingClientRect().width-w)<1', arg=width)
        scroll.evaluate('e=>{e.scrollTop=e.scrollHeight;e.scrollLeft=430;e.dispatchEvent(new Event("scroll"));}')
        page.wait_for_timeout(50)
        metrics = page.evaluate('''() => {
            const s=document.getElementById('projects-board-scroll'), h=document.getElementById('projects-board-header');
            const rows=[...document.querySelectorAll('#projects-board-rows > [data-row-id]')], last=rows.reduce((a,b)=>Number(a.getAttribute('aria-rowindex'))>Number(b.getAttribute('aria-rowindex'))?a:b);
            const headers=[...h.children], cells=[...last.children];
            const hitCell=rows.find(r=>r.dataset.rowKind==='task' && r.getBoundingClientRect().top>=h.getBoundingClientRect().bottom && r.getBoundingClientRect().bottom<innerHeight)?.firstElementChild;
            return {count:rows.length,left:s.scrollLeft,headerTop:h.getBoundingClientRect().top,scrollTop:s.getBoundingClientRect().top,
                lastBottom:last.getBoundingClientRect().bottom,viewportBottom:s.getBoundingClientRect().top+s.clientHeight,
                aligned:cells.every((c,i)=>Math.abs(c.getBoundingClientRect().left-headers[i].getBoundingClientRect().left)<1),
                sticky:Math.abs(cells[0].getBoundingClientRect().left-s.getBoundingClientRect().left)<2,
                titleOnTop:hitCell && document.elementFromPoint(hitCell.getBoundingClientRect().left+20,hitCell.getBoundingClientRect().top+20)?.closest('[data-column-key]')?.dataset.columnKey==='taskTitle',
                uniform:rows.every(r=>Math.abs(r.getBoundingClientRect().height-parseFloat(r.style.height))<1),
                lastIndex:Number(last.getAttribute('aria-rowindex')),total:Number(document.getElementById('projects-board-table').getAttribute('aria-rowcount'))};
        }''')
        assert metrics['count'] < 80 and metrics['left'] > 0, metrics
        assert metrics['aligned'] and metrics['uniform'] and metrics['sticky'] and metrics['titleOnTop'], metrics
        assert abs(metrics['headerTop']-metrics['scrollTop']) < 2, metrics
        assert abs(metrics['lastBottom']-metrics['viewportBottom']) < 2, metrics
        assert metrics['lastIndex'] == metrics['total'], metrics
        widths.append({'width': width, **metrics})
        page.screenshot(path=str(out/f'geometry-{stored}-{width}.png'), full_page=True)
    # Keyboard resizing preserves its handle and Escape restores the gesture start.
    scroll.evaluate('e=>{e.scrollLeft=0;e.scrollTop=0;}')
    handle = page.locator('[data-column-resize="taskTitle"]')
    handle.focus()
    old_width = int(handle.get_attribute('aria-valuenow'))
    page.keyboard.press('ArrowRight'); assert int(handle.get_attribute('aria-valuenow')) == old_width + 10
    page.keyboard.press('Escape'); assert int(handle.get_attribute('aria-valuenow')) == old_width
    box = handle.bounding_box()
    page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
    page.mouse.down(); page.mouse.move(box['x']+box['width']/2+30, box['y']+box['height']/2); page.mouse.up()
    assert int(handle.get_attribute('aria-valuenow')) == old_width + 30
    page.locator('.crm-projects-view-options > summary').click()
    page.locator('#projects-v2-columns > summary').click()
    page.locator('[data-column-visibility="dates"]').uncheck()
    assert page.locator('#projects-board-header [data-column-key="dates"]').count() == 0
    page.locator('[data-column-width="status"]').fill('210')
    page.locator('[data-column-width="status"]').press('Tab')
    assert page.locator('[data-column-resize="status"]').get_attribute('aria-valuenow') == '210'
    page.locator('[data-column-visibility="dates"]').check()
    page.keyboard.press('Escape')
    # A remote rank change before the viewport preserves the logical row and offset.
    scroll.evaluate('e=>{e.scrollTop=e.scrollHeight/2;e.dispatchEvent(new Event("scroll"));}')
    page.wait_for_timeout(50)
    anchor = page.evaluate('''() => {const s=document.getElementById('projects-board-scroll'),height=parseFloat(document.querySelector('#projects-board-rows > [data-row-id]').style.height),index=Math.floor(s.scrollTop/height)+2,r=document.querySelector(`[aria-rowindex="${index}"]`);return {id:r.dataset.rowId,offset:r.getBoundingClientRect().top-s.getBoundingClientRect().top};}''')
    page.evaluate('board.updateTask({...board.getState().tasks.get("t0"),rank:"99999/1",revision:2})')
    page.wait_for_timeout(50)
    offset = page.locator('[data-row-id="'+anchor['id']+'"]').evaluate('e=>e.getBoundingClientRect().top-document.getElementById("projects-board-scroll").getBoundingClientRect().top')
    assert abs(offset-anchor['offset']) < 1, ('logical anchor', anchor, offset)
    # Fixed geometry after density/text-size updates, including bottom reachability.
    for density, scale in [('compact', 1), ('comfortable', 1.5)]:
        scroll.evaluate('e=>e.scrollTop=e.scrollHeight/2')
        page.wait_for_timeout(50)
        before = scroll.evaluate('e=>e.scrollTop/parseFloat(document.querySelector("#projects-board-rows > [data-row-id]").style.height)')
        page.evaluate('([d,s])=>board.setDensity(d,s)', [density, scale])
        expected = 36 if density == 'compact' else 66
        after = scroll.evaluate('(e,h)=>e.scrollTop/h', expected)
        maximum = scroll.evaluate('(e,h)=>(e.scrollHeight-e.clientHeight)/h', expected)
        assert abs(min(before, maximum)-after) < 0.04, ('density anchor', before, after, maximum)
        scroll.evaluate('e=>{e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event("scroll"));}')
        page.wait_for_timeout(50)
        assert page.locator('#projects-board-rows > [data-row-id]').evaluate_all('(rows,h)=>rows.every(r=>r.getBoundingClientRect().height===h)', expected)
    assert page.evaluate('calls.every(c=>c.method==="GET")')
    return {'size': size, 'v2': True, 'legacy': stored, 'widths': widths, 'focusAndResize': True, 'rowOrder': order_result, 'writes': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    main = runpy.run_path(str(Path(__file__).with_name('v2-shell-browser-check.py')))['main']
    for size in [30, 500, 5000]:
        sys.argv = [__file__, '--out', str(Path(args.out)/str(size)), '--size', str(size)]
        main(check)
