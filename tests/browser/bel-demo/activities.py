"""Chrome activity rehearsals against an already-open four-view session.
See the demo README for physical starting positions. No world-state injection.
"""
import argparse,sys
sys.dont_write_bytecode=True
from driver import Driver
from playwright.sync_api import sync_playwright

def final(args):
 with sync_playwright() as pw:
  browser=pw.chromium.connect_over_cdp(args.cdp);d=Driver(browser,args.evidence)
  assert set(d.pages)=={'p0','p1','p2','p3'}
  state=d.snap('p0');assert state['session']['presentation']['active'] and state['world']['cubes']['pairs']==[True]*3
  frames={a:next(f for f in pg.frames if '/native/deck.html' in f.url) for a,pg in d.pages.items()}
  p=d.pages['p0'];p.locator('[data-slide=previous]').click()
  for a in d.pages:d.wait(a,'window.belDebug.snapshot().deck?.finalPage === "determine"')
  for f in frames.values():
   assert f.locator('[data-eta-banner]').evaluate('(e)=>getComputedStyle(e).visibility')=='hidden'
   text=f.locator('section[data-final-page]').inner_text();assert 'INDENTIFY' in text and 'TEACHING METHODOLY & TEACHING CONTENT' in text
  positions=d.snap('p0')['world']['players'];d.keys('p2',['w','a'],.25);assert d.snap('p0')['world']['players']==positions
  origin=state['world']['deck']['etaOrigin'];frames['p0'].get_by_role('button',name='Reveal ETA',exact=True).click()
  for a in d.pages:d.wait(a,'window.belDebug.snapshot().deck?.finalPage === "eta"')
  new_origin=d.snap('p0')['world']['deck']['etaOrigin'];assert origin is None or origin==new_origin
  p.wait_for_timeout(1200);d.shot('p0','final-native-ETA')
  texts={a:f.locator('[data-eta-banner]').inner_text() for a,f in frames.items()}
  assert len(set(texts.values()))==1,texts
  d.log('final-shared-native-countdown',values=texts)
  frames['p0'].locator('body').press('r')
  for a in d.pages:d.wait(a,'window.belDebug.snapshot().deck?.finalPage === "determine"')
  assert d.snap('p0')['world']['deck']['etaOrigin']==new_origin
  d.pages['p2'].keyboard.press('ArrowRight');p.wait_for_timeout(200);assert d.snap('p0')['world']['deck']['finalPage']=='determine'
  for width,height in [(1366,768),(1440,900),(1920,1080),(2560,1080)]:
   p.set_viewport_size({'width':width,'height':height});p.wait_for_timeout(600)
   rect=frames['p0'].locator('section[data-final-page]').bounding_box();assert rect['x']>=-1 and rect['y']>=-1 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=height+1,rect
   d.shot('p0',f'final-Determine-{width}x{height}')
  p.set_viewport_size({'width':1366,'height':768});p.locator('[data-slide=notes]').click();p.wait_for_timeout(700)
  frame_box=p.locator('#presentation iframe').bounding_box();note_box=p.locator('#notebook').bounding_box();assert frame_box['x']+frame_box['width']<note_box['x']
  if not p.locator('#notebook textarea').count():p.locator('[data-n=add]').click()
  p.locator('#notebook textarea').fill('Closing notes: WASD F E. We determine the approach together.');p.get_by_role('button',name='Save page',exact=True).click();p.wait_for_timeout(300)
  d.shot('p0','final-notes-refit');p.locator('[data-n=close]').click();d.checkpoint('final-package');assert not d.errors,d.errors
import asyncio,json,time,math
from pathlib import Path
from playwright.async_api import async_playwright
async def bridge(args):
 ROOT=Path(args.evidence);ROOT.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as pw:
  browser=await pw.chromium.connect_over_cdp(args.cdp);pages={p.url.split('actor=')[1][:2]:p for p in browser.contexts[0].pages if 'actor=' in p.url}
  async def snap():return await pages['p0'].evaluate('window.belDebug.snapshot()')
  async def player(a):return (await snap())['world']['players'][a]
  async def log(event,**data):
   row=dict(time=time.time(),event=event,**data);print(json.dumps(row),flush=True)
   with (ROOT/'bridge-live.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(row)+'\n')
  async def walk(a,x,y):
   page=pages[a];held=set();start=time.monotonic()
   try:
    while time.monotonic()-start<12:
     p=await player(a);dx=x-p['x'];dy=y-p['y']
     if math.hypot(dx,dy)<7:return
     needed=set()
     if abs(dx)>3:needed.add('d' if dx>0 else 'a')
     if abs(dy)>3:needed.add('s' if dy>0 else 'w')
     for k in held-needed:await page.keyboard.up(k)
     for k in needed:await page.keyboard.down(k)
     held=needed;await asyncio.sleep(.055)
    raise AssertionError((a,'stuck',(x,y),await player(a)))
   finally:
    for k in held:await page.keyboard.up(k)
  async def path(a,*points):
   for x,y in points:await walk(a,x,y)
  async def click(a,x,y):
   r=await pages[a].locator('#world').bounding_box();await pages[a].mouse.click(r['x']+x*r['width']/1000,r['y']+y*r['height']/480);await asyncio.sleep(.4)
  async def until(predicate,timeout=75):
   start=time.monotonic()
   while time.monotonic()-start<timeout:
    state=await snap()
    if predicate(state):return state
    await asyncio.sleep(.055)
   raise AssertionError('condition timed out')
  # Same session, same fixed 30-second clock. Staging uses the actual review.
  for page in pages.values():
   for k in 'wasd':await page.keyboard.up(k)
  state=await snap()
  if state['session']['pauseReasons']:
   await pages['p0'].locator('#presenter-tools summary').click();await pages['p0'].locator('#pause-button').click();await pages['p0'].locator('#presenter-tools summary').click()
  start_generation=state['world']['bridge']['generation']
  await until(lambda s:s['world']['bridge']['phase']=='review' and s['world']['bridge']['remaining']>9400,timeout=105)
  staging=time.monotonic()
  await path('p1',(418,330),(650,329))
  await path('p2',(486,305),(210,315))
  await path('p3',(554,350),(363,350))
  await log('sequential-staging',elapsed=time.monotonic()-staging,remaining=(await snap())['world']['bridge']['remaining'])
  await until(lambda s:s['world']['bridge']['phase']=='attempt');started=time.monotonic();lane=asyncio.Lock()
  async def build(a,index,pick,approach,exit_points):
   await path(a,*pick);o=(await snap())['world']['bridge']['planks'][index];await click(a,o['x'],o['y']);assert (await player(a))['carry']==o['id']
   await until(lambda s:s['world']['bridge']['placed']==index,timeout=30)
   async with lane:
    assert (await snap())['world']['bridge']['phase']=='attempt'
    await path(a,*approach);await click(a,500,233-index*16);assert (await snap())['world']['bridge']['placed']==index+1
    await log('placed',actor=a,index=index,remaining=(await snap())['world']['bridge']['remaining'])
    if index in [1,5]:await pages[a].screenshot(path=str(ROOT/f'F-built-{index+1}.png'))
    await path(a,*exit_points)
  async def one():
   await build('p1',0,[],[(550,270),(500,260)],[(550,270)])
   await build('p1',4,[(700,310),(795,338)],[(570,350),(550,270),(500,260),(500,206)],[(500,260),(560,270),(570,310)])
  async def two():
   await build('p2',1,[],[(430,275),(500,260)],[(450,270)])
   await build('p2',3,[(319,310)],[(430,280),(500,260),(500,222)],[(500,260),(450,270),(319,310)])
  async def three():
   await build('p3',2,[],[(500,350),(500,238)],[(500,260),(550,270)])
   await build('p3',5,[(682,300)],[(600,270),(500,260),(500,190)],[(500,175)])
  tasks=[asyncio.create_task(fn()) for fn in [one,two,three]]
  try:
   await asyncio.gather(*tasks);s=await snap();assert s['world']['bridge']['phase']=='complete' and not s['world']['bridge']['assisted'];await log('normal-completion',elapsed=time.monotonic()-started,state=s['world']['bridge']);(ROOT/'checkpoint-F-normal.json').write_text(json.dumps(s,indent=2),encoding='utf8')
  finally:
   for task in tasks:
    if not task.done():task.cancel()
   await asyncio.gather(*tasks,return_exceptions=True)
   for a in pages:
    for k in 'wasd':await pages[a].keyboard.up(k)
   await pages['p1'].screenshot(path=str(ROOT/'F-rehearsal-current.png'))


def choices(args):
 with sync_playwright() as p:
  b=p.chromium.connect_over_cdp(args.cdp);d=Driver(b,Path(args.evidence))
  def recap():
   d.interact('p0',(631,175));d.pages['p0'].get_by_role('button',name='Start presentation',exact=True).click()
   for a in d.pages:d.wait(a,'window.belDebug.snapshot().deck?.slide === 19',timeout=35000)
  recap();assert d.pages['p0'].locator('[data-slide=next]').is_disabled();assert d.snap('p0')['world']['deck']['slide']==19
  d.pages['p0'].locator('[data-slide=end]').click();d.pages['p0'].wait_for_timeout(300);assert not d.snap('p0')['world']['unlocked']['I']
  d.pages['p0'].locator('#presenter-tools summary').click();d.pages['p0'].locator('#bridge-start').click();d.pages['p0'].locator('#presenter-tools summary').click();began=time.monotonic()
  d.wait('p0','window.belDebug.snapshot().world.reversal.phase === "choice"');assert len(d.snap('p0')['world']['reversal']['results'])==0;d.shot('p1','I-full-statement')
  d.wait('p0','window.belDebug.snapshot().world.reversal.results.length === 1');r=d.snap('p0')['world']['reversal'];d.log('I-answer',result=r['results'][0]);assert not r['results'][0]['players']['p1']['correct'];assert r['results'][0]['players']['p2']['correct'];assert r['results'][0]['players']['p3']['choice'] is None
  x=d.player('p1')['x'];d.keys('p1',['d'],.25);assert d.player('p1')['x']<x;d.shot('p1','I-reversed-controls')
  d.pages['p0'].locator('#presenter-tools summary').click();d.pages['p0'].locator('#pause-button').click();d.pages['p0'].locator('#presenter-tools summary').click();d.pages['p0'].wait_for_timeout(250);frozen=d.snap('p0')['world']['reversal'];d.pages['p0'].wait_for_timeout(1200);assert d.snap('p0')['world']['reversal']==frozen
  before=d.player('p3');d.pages['p3'].locator('#notes-button').click();d.pages['p3'].locator('#notebook textarea').fill('WASD F E: freedom with responsibility.');d.pages['p3'].get_by_role('button',name='Save page',exact=True).click();d.pages['p3'].wait_for_timeout(300);assert d.player('p3')['x']==before['x'];assert d.player('p3')['y']==before['y'];d.pages['p3'].locator('[data-n=close]').click()
  d.pages['p0'].locator('#presenter-tools summary').click();d.pages['p0'].locator('#pause-button').click();d.pages['p0'].locator('#presenter-tools summary').click()
  recap();d.pages['p0'].wait_for_timeout(250);frozen=d.snap('p0')['world']['reversal'];d.pages['p0'].wait_for_timeout(1200);assert d.snap('p0')['world']['reversal']==frozen;d.shot('p0','I-recap-pauses-clocks');d.pages['p0'].locator('[data-slide=end]').click()
  d.wait('p0','window.belDebug.snapshot().world.reversal.results.length === 2',timeout=30000);r=d.snap('p0')['world']['reversal'];assert 0<r['debuffs']['p3']<4000;d.log('I-nonstacking-next-choice',state=r)
  d.wait('p1','window.belDebug.snapshot().world.reversal.debuffs.p1 === 0',timeout=8000);x=d.player('p1')['x'];d.keys('p1',['d'],.2);assert d.player('p1')['x']>x
  for n in [3,4,5,6]:
   d.wait('p0',f'window.belDebug.snapshot().world.reversal.results.length >= {n}',timeout=25000);d.log('I-answer',result=d.snap('p0')['world']['reversal']['results'][n-1])
  r=d.snap('p0')['world']['reversal'];assert r['phase']=='complete' and len(r['results'])==6 and all(v==0 for v in r['debuffs'].values());d.shot('p1','I-complete');d.log('I-sequence-complete',elapsed=time.monotonic()-began)
  recap();d.pages['p0'].locator('[data-slide=next]').click()
  for a in d.pages:d.wait(a,'window.belDebug.snapshot().deck?.slide === 20')
  d.shot('p0','I-native-creed-20');d.pages['p0'].locator('[data-slide=end]').click();d.wait('p0','window.belDebug.snapshot().world.unlocked.I === true');d.checkpoint('I');assert not d.errors,d.errors

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['F','I','final'],required=True);parser.add_argument('--cdp',default='http://127.0.0.1:9228');parser.add_argument('--evidence',required=True);args=parser.parse_args()
 if args.stage=='F':asyncio.run(bridge(args))
 elif args.stage=='I':choices(args)
 else:final(args)
