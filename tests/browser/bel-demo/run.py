import argparse,json,time,sys
sys.dont_write_bytecode=True
from pathlib import Path
from playwright.sync_api import sync_playwright
from driver import Driver

parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4178');parser.add_argument('--cdp',default='http://127.0.0.1:9228');parser.add_argument('--evidence',required=True);parser.add_argument('--stage',choices=['arrival','reception','A','B','C','D','E','G','recovery'],required=True);args=parser.parse_args()
expected=json.loads((Path(__file__).parents[2]/'fixtures/bel-demo/expected-content.json').read_text(encoding='utf-8'))

def arrival(d):
    for i in range(4):
        a=f'p{i}';p=d.pages[a];p.locator('#profile-button').click();p.locator('[name=name]').fill(['Minh','Lan','Mai','An'][i]);p.locator('[name=shirt]').select_option(['red','teal','cream','amber'][i]);p.locator('[name=hat]').select_option('straw' if i==3 else 'none');p.locator('[name=glasses]').set_checked(i==1);p.get_by_role('button',name='Save character').click()
    d.keys('p1',['d'],.35);d.keys('p1',['w','a'],.35);d.keys('p1',['s'],.4);d.keys('p1',['a'],.3);d.keys('p1',['d','s'],.3);d.keys('p1',['w'],.3);d.keys('p1',['a','s'],.25);d.keys('p1',['d','w'],.25)
    d.path('p1',(500,340),(500,378));assert d.player('p1')['y']>369;d.shot('p1','home-lower-floor')
    before=d.player('p1');d.interact('p1',(800,180));assert abs(d.player('p1')['x']-before['x'])<1
    d.path('p1',(720,320),(635,150));d.keys('p1',['w'],.7);assert d.player('p1')['y']>=138
    d.path('p1',(710,300),(500,375))
    for a,ride,x in [('p2','scooter',380),('p3','skateboard',622)]:
        d.path(a,(x,315),(x,331));d.interact(a,(x,365) if a=='p3' else None);assert d.player(a)['ride']==ride
        d.keys(a,['a'],.35);d.keys(a,['d','w'],.35);d.keys(a,['s'],.2);d.shot(a,'home-'+ride+'-pose')
        d.pages[a].locator('#dismount-button').click();d.pages[a].wait_for_timeout(350);assert d.player(a)['ride'] is None
        d.path(a,(x,330));d.interact(a,(x,365));assert d.player(a)['ride']==ride
    d.checkpoint('home')
    for a in ['p1','p2','p3']:
        d.path(a,(500,332),(500,399));d.enter(a,'street')
        d.path(a,(500,370));d.shot(a,'street-'+a)
        # Wait on the curb, cross using actual movement; a bump safely retries.
        for attempt in range(5):
            d.keys(a,['w'],1.9 if d.player(a)['ride'] else 2.7)
            if d.player(a)['y']<170:break
            d.path(a,(500,366));d.pages[a].wait_for_timeout(750)
        d.path(a,(500,151));d.enter(a,'reception',(500,135));assert d.player(a)['ride'] is None
        d.path(a,(430+int(a[1])*45,345))
    d.checkpoint('arrival')

def reception(d):
    d.path('p1',(410,345),(420,290));d.path('p2',(460,345),(455,290));d.interact('p1',(455,290));
    assert d.pages['p1'].locator('[data-social]').all_text_contents()==['View notes','Say hi','Hold hands']
    d.pages['p1'].get_by_role('button',name='Hold hands',exact=True).click();d.pages['p2'].locator('[data-decline]').click();d.pages['p2'].wait_for_timeout(350);assert not d.player('p1')['follower']
    d.interact('p1',(455,290));d.pages['p1'].get_by_role('button',name='Say hi',exact=True).click();d.pages['p1'].wait_for_timeout(250);assert d.player('p1')['waveUntil']>time.time()*1000
    d.interact('p1',(455,290));d.pages['p1'].get_by_role('button',name='Hold hands',exact=True).click();d.pages['p2'].locator('[data-accept]').click();d.pages['p2'].wait_for_timeout(300)
    d.keys('p1',['a'],.5);assert d.player('p2')['leader']=='p1';d.shot('p1','reception-hold-hands')
    d.pages['p2'].locator('#notes-button').click();d.pages['p2'].locator('#notebook input').fill('First thought');d.pages['p2'].locator('#notebook textarea').fill('WASD F E are writing. We can begin together.');d.pages['p2'].get_by_role('button',name='Save page',exact=True).click();d.pages['p2'].wait_for_timeout(450);assert d.player('p2')['leader']=='p1';d.shot('p2','notebook-saved-ink');d.pages['p2'].locator('[data-n=close]').click()
    d.keys('p2',['e'],.05);assert not d.player('p2')['leader']
    d.interact('p1',(d.player('p2')['x'],d.player('p2')['y']));d.pages['p1'].get_by_role('button',name='View notes',exact=True).click();assert 'We can begin together.' in d.pages['p1'].locator('.ink').inner_text();d.pages['p1'].locator('[data-n=close]').click()
    d.checkpoint('reception')
    for a in ['p0','p1','p2']:
        d.path(a,(d.player(a)['x'],270),(720,270),(720,190),(633,178));d.enter(a,'A');d.path(a,(260+int(a[1])*45,355))

def studio(d,room):
    active=d.snap('p0')['session']['presentation']['active']
    if room=='A' and not active:
        if d.player('p3')['scene']!='A':
            d.path('p0',(290,185),(580,185),(631,183));d.interact('p0');assert d.pages['p0'].get_by_role('button',name='Start presentation').is_disabled();d.shot('p0','A-readiness-missing');d.close_panel('p0')
            d.path('p3',(720,330),(720,190),(633,178));d.enter('p3','A');d.path('p3',(680,355))
        d.path('p2',(350,299),(220,299))
        d.path('p1',(445,365),(445,291),(400,290));d.interact('p1',(400,260));assert d.player('p1')['seat']=='seat-0-0';d.shot('p1','A-seated');d.interact('p1');assert d.player('p1')['seat'] is None;d.path('p1',(445,291),(445,365),(300,365))
        d.path('p2',(200,350),(130,249));d.interact('p2',(99,249));assert 'Locked' in d.pages['p2'].locator('#toast').inner_text();assert d.pages['p2'].locator('#panel').is_hidden();d.path('p2',(220,330))
    elif room in ['C','E','G'] and not active:d.path('p0',(d.player('p0')['x'],370),(240,370),(240,185),(580,185),(631,183))
    if not active:
        d.interact('p0',(631,175));d.pages['p0'].get_by_role('button',name='Start presentation',exact=True).click()
    for a in d.pages:d.wait(a,'window.belDebug.snapshot().frameReady === true',timeout=35000)
    first,last={'A':(1,3),'C':(4,9),'E':(10,16),'G':(17,18)}[room]
    for n in range(first,last+1):
        for a in d.pages:d.wait(a,f'window.belDebug.snapshot().deck?.slide === {n}')
        if n in [2,4,5,6]:
            cycle=3 if n==2 else 4
            for reveal in range(cycle):
                wanted=d.snap('p0')['world']['deck']['steps'][str(n)]%cycle+1
                frame=d.pages['p0'].frame_locator('#presentation iframe');frame.locator('section[data-deck-active] button').click()
                for a in d.pages:d.wait(a,f'window.belDebug.snapshot().deck?.steps["{n}"] === {wanted}')
            d.shot('p0',room+'-native-slide-'+str(n))
        if n==2:
            before=d.player('p1');d.keys('p1',['d'],.4);assert abs(d.player('p1')['x']-before['x'])<1
            d.pages['p1'].locator('[data-slide=notes]').click();d.pages['p1'].locator('#notebook textarea').fill('Notes during slides: WASD F E.');d.pages['p1'].get_by_role('button',name='Save page',exact=True).click();d.pages['p1'].wait_for_timeout(300);d.pages['p1'].locator('[data-n=close]').click()
            for a in d.pages:d.shot(a,'A-slide-four-views-'+a)
        if n<last:d.pages['p0'].locator('[data-slide=next]').click()
    d.pages['p0'].locator('[data-slide=previous]').click();d.wait('p2',f'window.belDebug.snapshot().deck?.slide === {last-1}');d.pages['p0'].locator('[data-slide=next]').click()
    d.shot('p0',room+'-last-native-slide');d.pages['p0'].locator('[data-slide=end]').click();d.wait('p0',f'window.belDebug.snapshot().world.unlocked.{room} === true');d.shot('p0',room+'-doors-unlocked');d.checkpoint(room)

def routes(d):
    for a,route in [('p1','B1'),('p2','B2'),('p3','B3'),('p0','B1')]:
        if d.player(a)['scene']=='C' and all(o['placed'] for o in d.snap(a)['world']['routes'][route]):continue
        if d.player(a)['scene']!=route:
            if route=='B1':d.path(a,(260,180),(180,249),(130,249));d.enter(a,route,(99,249))
            elif route=='B2':d.path(a,(270,205),(710,205),(740,180));d.enter(a,route,(747,148))
            else:d.path(a,(730,350),(867,249));d.enter(a,route,(900,249))
        if a=='p0':d.path(a,(165,300),(158,345));continue
        for i,(pick,place) in enumerate([((275,294),(230,267)),((453,277),(486,186)),((617,247),(716,227))]):
            observed=d.snap(a)['world']['routes'][route][i]
            if observed['placed']:continue
            pick=(observed['x'],observed['y']-23)
            d.path(a,(pick[0],300),pick);d.interact(a,(pick[0],pick[1]+23));assert d.player(a)['carry']==f'shape-{i}'
            if a=='p1' and i==0:
                d.path(a,(380,277),(400,186),(486,186));d.interact(a,(486,179));assert d.player(a)['carry']=='shape-0';assert 'does not fit' in d.pages[a].locator('#toast').inner_text();d.path(a,(380,270))
            if i==1:d.path(a,(390,277),(399,186),place)
            else:d.path(a,(place[0],270),place)
            d.interact(a,(place[0],place[1]-10));assert d.pages[a].locator('.source-text').inner_text()==expected[route][i];d.shot(a,route+'-source-'+str(i));d.close_panel(a)
        d.path(a,(815,270),(866,189));d.enter(a,'C',(883,165));d.path(a,(260+int(a[1])*43,354))
    # Presenter sees the same-route matches, each panel still opens individually.
    if d.player('p0')['scene']=='B1':
        d.path('p0',(230,270));d.interact('p0',(230,256));assert d.pages['p0'].locator('.source-text').inner_text()==expected['B1'][0];d.close_panel('p0');d.path('p0',(815,270),(866,189));d.enter('p0','C',(883,165))
    d.checkpoint('B')

def gallery(d):
    walk=d.walk
    d.walk=lambda a,x,y,**kw:walk(a,x,y,tolerance=2,**kw)
    for a in ['p1','p2','p3','p0']:
        if d.player(a)['scene']!='D':
            d.path(a,(d.player(a)['x'],370),(220,370),(220,215),(710,215),(748,176));d.enter(a,'D',(747,148))
            d.path(a,(d.player(a)['x'],423),(260+int(a[1])*80,423))
    points=[(149,283),(294,197),(483,197),(669,197),(851,283)]
    names=['Chet Faliszek','Josh Weier','Mike Morasky','Erik Wolpaw','Rich Geldreich']
    for i,(x,y) in enumerate(points):
        a=f'p{(i%3)+1}';side=300 if x<500 else 730
        d.path(a,(d.player(a)['x'],403),(side,403),(side,205),(x,y));d.interact(a,(x,y))
        assert names[i] in d.pages[a].locator('#panel h2').inner_text()
        exact=d.pages[a].evaluate("""async n=>{const doc=new DOMParser().parseFromString(await(await fetch('/native/deck.html')).text(),'text/html');return doc.querySelector('section[data-screen-label="'+n+'"] blockquote').textContent.replace(/\\s+/g,' ').trim()}""",str(10+i))
        assert d.pages[a].locator('#panel blockquote').inner_text()==exact
        d.shot(a,'D-'+names[i].split()[0]);d.close_panel(a);d.path(a,(side,205),(side,403),(260+int(a[1])*80,403),(260+int(a[1])*80,423))
    d.path('p0',(200,403),(200,205),(810,205),(824,195));d.interact('p0',(824,178));d.shot('p0','D-onward-threshold');d.close_panel('p0');d.checkpoint('D')


with sync_playwright() as p:
    b=p.chromium.connect_over_cdp(args.cdp);d=Driver(b,args.evidence)
    try:
        if args.stage=='arrival':arrival(d)
        elif args.stage=='reception':reception(d)
        elif args.stage=='A':studio(d,'A')
        elif args.stage=='B':routes(d)
        elif args.stage=='C':studio(d,'C')
        elif args.stage=='D':gallery(d)
        elif args.stage in ['E','G']:studio(d,args.stage)
        else:
            before=d.snap('p2');d.pages['p2'].reload();d.wait('p2','window.belDebug && document.body.dataset.ready === "true"');after=d.snap('p2');assert before['session']['id']==after['session']['id'];assert before['session']['players']['p2']['notes']==after['session']['players']['p2']['notes'];d.checkpoint('recovery')
        assert not d.errors,d.errors
    except Exception as e:
        d.log('FAIL',stage=args.stage,error=str(e));d.checkpoint(args.stage+'-failed')
        for a in d.pages:d.shot(a,args.stage+'-failure-'+a)
        raise
