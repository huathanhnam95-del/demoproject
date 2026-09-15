"""Chrome-only four-account rehearsal for the authenticated online demo.

The accounts file is intentionally external to the repository. Accounts are
created in the local Firebase Auth emulator and every application request uses
the resulting bearer token; no production credential is accepted here.
"""

from __future__ import annotations

import argparse
import json
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import expect, sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=["chrome"], required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--failover-url")
    parser.add_argument("--failover-signal")
    parser.add_argument("--accounts-file", required=True)
    parser.add_argument("--evidence", required=True)
    return parser.parse_args()


def wait_for_text(page, selector: str, text: str, timeout: int = 10000) -> None:
    page.locator(selector).wait_for(state="visible", timeout=timeout)
    page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent.includes(text)",
        arg=[selector, text],
        timeout=timeout,
    )


def open_lobby(context, base_url: str, account: dict):
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto(f"{base_url}/presentation-demo/index.html", wait_until="domcontentloaded")
    page.wait_for_function("() => window.firebase && typeof window.firebase.auth === 'function'")
    print(f"rehearsal: signing in {account['uid']}", flush=True)
    page.evaluate(
        """async ({email, password}) => {
            await window.firebase.auth().signInWithEmailAndPassword(email, password);
        }""",
        {"email": account["email"], "password": account["password"]},
    )
    print(f"rehearsal: signed in {account['uid']}", flush=True)
    page.reload(wait_until="domcontentloaded")
    print(f"rehearsal: reloaded {account['uid']}", flush=True)
    print(f"rehearsal: auth status {account['uid']} = {page.locator('#pd-auth-status').inner_text()!r}", flush=True)
    wait_for_text(page, "#pd-auth-status", "Signed in", timeout=30000)
    return page


def open_game(page, allow_existing: bool = False):
    with page.expect_popup(timeout=10000) as popup_info:
        page.locator("#pd-open-game").click()
    game = popup_info.value
    game.set_default_timeout(15000)
    game.wait_for_load_state("domcontentloaded")
    try:
        if allow_existing:
            game.locator("#pd-connection-status").wait_for(state="visible", timeout=15000)
        else:
            wait_for_text(game, "#pd-connection-status", "Connected", timeout=15000)
    except PlaywrightTimeoutError:
        status = game.locator("#pd-connection-status").inner_text()
        message = game.locator("#pd-game-message").inner_text()
        raise AssertionError(f"Game connection did not become ready: status={status!r}, message={message!r}, url={game.url!r}")
    return game


def world_snapshot(page) -> dict:
    return page.evaluate("window.belOnlineDebug.snapshot()")


def plan_walk(page, target):
    return page.evaluate(
        """async target => {
          const {room,seatId} = window.belOnlineDebug.snapshot();
          const w=room.gameplay,p=w.players[seatId];
          const sim=await import('/js/presentation-demo/core/world/simulation.mjs');
          const geo=await import('/js/presentation-demo/core/world/geometry.mjs');
          const {SCENES}=await import('/js/presentation-demo/core/world/scenes.mjs');
          const t=typeof target==='string'?sim.targets(w,seatId).find(t=>t.id===target):target;
          if(!t)throw Error('Target unavailable: '+JSON.stringify(target));
              const reach=typeof target==='string'?47:27;
              if(geo.distance(p,t)<=reach)return {done:true,p,t};
          const solids=sim.solidsFor(w,seatId),scene=SCENES[p.scene],radius=p.ride?15:10;
          const start={x:p.x,y:p.y,g:0,h:geo.distance(p,t),parent:null};
          const open=[start],seen=new Map([['0,0',0]]);
          let found=null,visits=0;
          while(open.length&&visits++<15000){
            open.sort((a,b)=>(b.g+b.h)-(a.g+a.h));const current=open.pop();
            if(geo.distance(current,t)<=reach){found=current;break;}
            // End on the interaction circle even when its narrow reachable
            // strip falls between grid rows (notably J's tabletop cubes).
            const gap=geo.distance(current,t);
            if(gap<=reach+9){
              const scale=(gap-reach+.1)/gap;
              const approach=geo.move(current,(t.x-current.x)*scale,(t.y-current.y)*scale,scene,solids,radius);
              if(geo.distance(approach,t)<=reach){found={...approach,parent:current};break;}
            }
            for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
              const x=current.x+dx*6,y=current.y+dy*6;
              if(x<0||x>1000||y<0||y>480)continue;
              const moved=geo.move(current,dx*6,dy*6,scene,solids,radius);
              if(Math.hypot(moved.x-x,moved.y-y)>.01)continue;
              const g=current.g+Math.hypot(dx,dy)*6,k=Math.round((x-p.x)/6)+','+Math.round((y-p.y)/6);
              if((seen.get(k)??Infinity)<=g)continue;
              seen.set(k,g);open.push({x,y,g,h:Math.max(0,Math.hypot(x-t.x,y-t.y)-reach),parent:current});
            }
          }
          if(!found)throw Error('No walkable path '+JSON.stringify({p,t,visits}));
          const raw=[];while(found.parent){raw.unshift({x:found.x,y:found.y});found=found.parent;}
          const corners=[];let previous=start,direction='';
          for(let i=0;i<raw.length;i++){
            const point=raw[i],nextDirection=Math.sign(point.x-previous.x)+','+Math.sign(point.y-previous.y);
            if(direction&&direction!==nextDirection)corners.push(previous);
            direction=nextDirection;previous=point;
          }
          corners.push(raw.at(-1));return {done:false,p,t,point:corners[0]};
        }""", target)


def walk_to(page, target, timeout=35):
    """Read the committed world, plan through its floor, and press real keys."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        path = plan_walk(page,target)
        if path['done']:
            return
        player,point=path['p'],path['point']
        dx,dy=point['x']-player['x'],point['y']-player['y']
        keys=[]
        if abs(dx)>2: keys.append('d' if dx>0 else 'a')
        if abs(dy)>2: keys.append('s' if dy>0 else 'w')
        if not keys:
            # A continuous endpoint can be less than two pixels away. Press
            # toward its strongest axis instead of spinning without input.
            keys.append(('d' if dx>0 else 'a') if abs(dx)>abs(dy) else ('s' if dy>0 else 'w'))
        page.locator('#pd-world').focus()
        for key in keys: page.keyboard.down(key)
        duration=min(450,max(85,(dx*dx+dy*dy)**.5/(165 if player.get('ride') else 108)*1000-45))
        page.wait_for_timeout(duration)
        for key in keys: page.keyboard.up(key)
        page.wait_for_timeout(220)
    raise AssertionError(f'Walking timed out toward {target}: {world_snapshot(page)}')


def interact_target(page, target, expected_kind=None):
    walk_to(page,target)
    location=page.evaluate("target => {const s=window.belOnlineDebug.snapshot();return import('/js/presentation-demo/core/world/simulation.mjs').then(m=>m.targets(s.room.gameplay,s.seatId).find(t=>t.id===target));}",target)
    box=page.locator('#pd-world').bounding_box()
    page.locator('#pd-world').click(position={'x':location['x']*box['width']/1000,'y':location['y']*box['height']/480})
    if expected_kind:
        page.wait_for_function("kind => {const p=document.querySelector('#pd-world-panel');return !p.hidden && p.dataset.kind===kind;}",arg=expected_kind)
    page.wait_for_timeout(200)


def enter_door(page, target, scene):
    interact_target(page,target,'door')
    page.locator('#pd-world-panel [data-enter]').click()
    page.wait_for_function("scene => document.body.dataset.scene===scene && document.body.dataset.ready==='true'",arg=scene)


def close_panel(page):
    if page.locator('#pd-world-panel').is_visible(): page.locator('#pd-world-panel [data-close]').click()


def open_presentation(page,scene):
    interact_target(page,'monitor','monitor')
    page.locator('#pd-world-panel [data-presentation-start]').click()
    page.wait_for_function("scene => {const w=window.belOnlineDebug.snapshot().room.gameplay;return w.presentation.active&&w.presentation.roomId===scene;}",arg=scene)


def walk_group(games, destinations, timeout=40):
    deadline=time.monotonic()+timeout
    pending=dict(destinations)
    while pending and time.monotonic()<deadline:
        held=[]
        for uid,target in list(pending.items()):
            page=games[uid]; path=plan_walk(page,target)
            if path['done']: del pending[uid]; continue
            player,point=path['p'],path['point']; dx,dy=point['x']-player['x'],point['y']-player['y']
            # A wrong floor answer reverses the real controls; compensate with
            # the same keyboard that a player uses, never a state mutation.
            snap=world_snapshot(page)
            reverse=player['scene']=='I' and snap['room']['gameplay']['reversal']['debuffs'].get(player['id'],0)>0
            if reverse: dx,dy=-dx,-dy
            keys=[]
            if abs(dx)>2: keys.append('d' if dx>0 else 'a')
            if abs(dy)>2: keys.append('s' if dy>0 else 'w')
            if not keys: keys.append(('d' if dx>0 else 'a') if abs(dx)>abs(dy) else ('s' if dy>0 else 'w'))
            page.locator('#pd-world').focus()
            for key in keys: page.keyboard.down(key)
            held.append((page,keys))
        if not held: break
        held[0][0].wait_for_timeout(180)
        for page,keys in held:
            for key in keys: page.keyboard.up(key)
        held[0][0].wait_for_timeout(180)
    if pending: raise AssertionError(f'Group walking timed out: {pending}')


def physical_route(games,presenter,participants,base_url,room_id,evidence,result):
    actors=[presenter,*participants]; host=games[presenter]; trace=[]
    def record(stage):
        snap=world_snapshot(host)
        trace.append({'stage':stage,'revision':snap['room']['revision'],'scenes':{k:p['scene'] for k,p in snap['room']['gameplay']['players'].items()}})
        print('rehearsal: physical route '+stage,flush=True)
        host.screenshot(path=str(evidence/('world-'+stage+'.png')),full_page=True)
    def doors(target,scene):
        for uid in actors: enter_door(games[uid],target,scene)
        record(scene)
    def present(scene,last):
        open_presentation(host,scene)
        if scene=='A':
            host.locator('#pd-display-options summary').click()
            host.locator('#pd-show-quotes').uncheck()
            host.locator('#pd-show-folio').uncheck()
            host.locator('#pd-photo-treatment').select_option('Full colour')
            for uid in actors:
                games[uid].wait_for_function("() => {const p=window.belOnlineDebug.snapshot().room.deck.properties; return p.showQuotes===false&&p.showFolio===false&&p.photoTreatment==='Full colour';}")
            result['assertions'].append('presentation-properties-shared-across-four-clients')
        first=world_snapshot(host)['room']['deck']['slide']
        for slide in range(first,last+1):
            if slide>first: advance_slide(games,presenter,actors,scene,slide,base_url,room_id)
            for uid in actors:
                rendered=games[uid].frame_locator('#pd-deck').locator(f'deck-stage > section[data-deck-slide="{slide-1}"][data-deck-active]')
                expect(rendered).to_be_visible(timeout=15000)
            if slide in [2,4,5,6]:
                host.locator('#pd-reveal').click()
                for uid in actors:
                    games[uid].wait_for_function("slide => window.belOnlineDebug.snapshot().room.deck.steps[slide]===2",arg=slide)
                    shown=games[uid].frame_locator('#pd-deck').locator('section[data-deck-active] [data-phase="shown"]')
                    expect(shown).to_have_count(2 if slide==2 else 1,timeout=15000)
        host.locator('#pd-close-presentation').click()
        host.wait_for_function('!window.belOnlineDebug.snapshot().room.gameplay.presentation.active')
        record(scene+'-presentation')
    # Home customization and a physical vehicle trip use the real controls.
    game=games[participants[0]]
    game.locator('#pd-profile').click();game.locator('#pd-world-panel input[name=name]').fill('Chrome character')
    game.get_by_role('button',name='Save character',exact=True).click()
    interact_target(game,'scooter');game.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.players.p1.ride==='scooter'")
    for uid in participants:
        enter_door(games[uid],'exit','street');enter_door(games[uid],'bel','reception')
    record('reception')
    # One explicit invitation and acceptance; release before independent travel.
    interact_target(games[participants[0]],'p2','person')
    games[participants[0]].locator('[data-social=hold]').click()
    games[participants[1]].get_by_role('button',name='Accept',exact=True).click()
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.players.p1.follower==='p2'")
    games[participants[1]].locator('#pd-release').click()
    host.wait_for_function("!window.belOnlineDebug.snapshot().room.gameplay.players.p1.follower")
    doors('studio','A')
    interact_target(games[participants[0]],'seat-1-0')
    games[participants[0]].wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.players.p1.seat==='seat-1-0'")
    # The authored input ignores repeated interactions within 350 ms. Wait
    # beyond that debounce and verify standing before independent travel.
    games[participants[0]].wait_for_timeout(400)
    games[participants[0]].locator('#pd-world').focus();games[participants[0]].keyboard.press('f')
    games[participants[0]].wait_for_function("!window.belOnlineDebug.snapshot().room.gameplay.players.p1.seat")
    present('A',3)
    # Every B route is visited. Each reflection requires its physical shape.
    for index,uid in enumerate(participants):
        route='B'+str(index+1);enter_door(games[uid],'door-'+str(index+1),route)
        for shape in range(3):
            interact_target(games[uid],'shape-'+str(shape))
            games[uid].wait_for_function("([id,object])=>window.belOnlineDebug.snapshot().room.gameplay.players[id].carry===object",arg=['p'+str(index+1),'shape-'+str(shape)])
            interact_target(games[uid],'pedestal-'+str(shape),'reflection');close_panel(games[uid])
        enter_door(games[uid],'onward','C')
    enter_door(host,'door-1','B1');enter_door(host,'onward','C');record('B1-B2-B3')
    present('C',9);doors('onward','D')
    for index in range(5): interact_target(host,'portrait-'+str(index),'portrait');close_panel(host)
    record('D-portraits');doors('end','E');present('E',16);doors('onward','F')
    host.locator('#pd-activity-start').click();host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.phase==='preparation'")
    before=world_snapshot(host)['room']['gameplay']['bridge'];assert 58000<before['remaining']<=60000
    # Preserve the authored first 60/30/10 loop and demonstrate physical carry.
    interact_target(games[participants[0]],'plank-0')
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.phase==='attempt'",timeout=70000)
    interact_target(games[participants[0]],'plank-0')
    games[participants[0]].wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.players.p1.carry==='plank-0'")
    interact_target(games[participants[0]],'bridge-next')
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.placed===1")
    generation=world_snapshot(host)['room']['gameplay']['bridge']['generation']
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.phase==='review'",timeout=35000)
    review=world_snapshot(host)['room']['gameplay']['bridge'];assert review['generation']==generation+1 and 8500<review['remaining']<=10000
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.phase==='attempt'",timeout=12000)
    host.locator('#pd-skip-activity').click();host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.bridge.placed===6")
    result['bridgeLoop']={'preparationMs':before['remaining'],'reviewMs':review['remaining'],'generation':review['generation'],'placedBeforeReset':review['lastPlaced'],'assisted':True}
    doors('onward','G');present('G',18);doors('onward','I')
    present('I',19)
    # Stay on authored floor regions through all six timed questions.
    walk_group(games,{participants[0]:{'x':300,'y':290},participants[1]:{'x':710,'y':285},participants[2]:{'x':750,'y':325}})
    host.locator('#pd-activity-start').click()
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.reversal.results.length>=1",timeout=12000)
    first=world_snapshot(host)['room']['gameplay']['reversal'];assert first['results'][0]['players']['p1']['correct'] and not first['results'][0]['players']['p2']['correct']
    assert 0<first['debuffs']['p2']<=20000
    # Real disconnect leaves the remaining activity running and records an
    # explicitly unevaluated answer. Reopen the same account afterward.
    offline=games[participants[2]];offline_context=offline.context;offline_url=offline.url;offline.close()
    host.wait_for_function("!window.belOnlineDebug.snapshot().room.slots.p3.connected",timeout=25000)
    host.wait_for_function("window.belOnlineDebug.snapshot().room.gameplay.reversal.phase==='complete'",timeout=120000)
    reversal=world_snapshot(host)['room']['gameplay']['reversal']
    assert len(reversal['results'])==6 and any(row['players']['p3'].get('evaluated') is False for row in reversal['results'][1:])
    offline=offline_context.new_page();offline.goto(offline_url);wait_for_text(offline,'#pd-connection-status','Connected',timeout=30000);games[participants[2]]=offline
    offline.wait_for_function("document.body.dataset.ready==='true'")
    result['reversal']=reversal;present('I',20);doors('onward','J')
    # Complete three normal pairs using two distinct physical carriers.
    for left,right,pair in [(1,3,0),(2,5,1),(0,4,2)]:
        for uid,cube in [(participants[0],left),(participants[1],right)]:
            interact_target(games[uid],'cube-'+str(cube))
            games[uid].wait_for_function("([id,cube])=>window.belOnlineDebug.snapshot().room.gameplay.players[id].carry===cube",arg=['p1' if uid==participants[0] else 'p2','cube-'+str(cube)])
        walk_to(games[participants[0]],{'x':320,'y':345});walk_to(games[participants[1]],{'x':360,'y':345})
        interact_target(games[participants[0]],'p2')
        host.wait_for_function("pair=>window.belOnlineDebug.snapshot().room.gameplay.cubes.pairs[pair]===true",arg=pair)
    record('J-three-normal-pairs');open_presentation(host,'J')
    assert world_snapshot(host)['room']['deck']['finalPage']=='determine'
    host.locator('#pd-slide-next').click();host.wait_for_function("window.belOnlineDebug.snapshot().room.deck.finalPage==='eta'")
    eta=world_snapshot(host)['room']['deck']['etaOrigin'];assert eta
    for uid in actors: games[uid].wait_for_function("origin=>window.belOnlineDebug.snapshot().room.deck.etaOrigin===origin",arg=eta)
    eta_values=[]
    for uid in actors:
        frame=games[uid].frame_locator('#pd-deck')
        banner=frame.locator('[data-eta-banner][data-phase=shown]')
        expect(banner).to_be_visible(timeout=15000)
        values=banner.locator('div[style*="font-size:58px"],div[style*="font-size: 58px"]').all_text_contents()
        assert len(values)==5,values
        months,days,hours,minutes,seconds=map(int,values)
        eta_values.append(months*30*86400+days*86400+hours*3600+minutes*60+seconds)
    assert max(eta_values)-min(eta_values)<=2,eta_values
    result['renderedEtaSeconds']=eta_values
    result['assertions'].append('native-ETA-rendered-consistently-with-plus-minus-two-minute-client-clock-skew')
    result['etaOrigin']=eta;result['routeTrace']=trace;result['assertions'].append('physical-home-street-reception-A-B1-B2-B3-C-D-E-F-G-I-J-and-shared-ETA')


def advance_slide(
    games: dict,
    presenter: str,
    uids: list[str],
    expected_scene: str,
    expected_slide: int,
    base_url: str,
    room_id: str,
) -> None:
    previous_gates = {uid: games[uid].locator("#pd-gate").inner_text() for uid in uids}
    games[presenter].locator("#pd-slide-next").click()
    presenter_token = games[presenter].evaluate("window.firebase.auth().currentUser.getIdToken()")
    deadline = time.monotonic() + 15
    authoritative_deck = None
    while time.monotonic() < deadline:
        response = games[presenter].request.get(
            f"{base_url}/api/presentation-demo/rooms/{room_id}",
            headers={"Authorization": f"Bearer {presenter_token}"},
        )
        if response.status == 200:
            authoritative_deck = response.json().get("data", {}).get("deck")
            if authoritative_deck and authoritative_deck.get("room") == expected_scene and authoritative_deck.get("slide") == expected_slide:
                break
        games[presenter].wait_for_timeout(200)
    else:
        raise AssertionError(
            f"Authoritative slide did not advance to {expected_scene}/{expected_slide}: deck={authoritative_deck!r}, "
            f"message={games[presenter].locator('#pd-game-message').inner_text()!r}, connection={games[presenter].locator('#pd-connection-status').inner_text()!r}"
        )
    for uid in uids:
        try:
            games[uid].wait_for_function(
                """([selector, expectedScene, expectedSlide, previous]) => {
                    const gate = document.querySelector(selector);
                    const text = gate?.textContent || '';
                    return gate?.dataset.deckRoom === expectedScene
                        && gate?.dataset.deckSlide === String(expectedSlide);
                }""",
                arg=["#pd-gate", expected_scene, expected_slide, previous_gates[uid]],
                timeout=15000,
            )
        except PlaywrightTimeoutError:
            raise AssertionError(
                f"Slide did not advance to {expected_scene}/{expected_slide} for {uid}: gate={games[uid].locator('#pd-gate').inner_text()!r}, "
                f"authoritative_deck={authoritative_deck!r}, "
                f"message={games[uid].locator('#pd-game-message').inner_text()!r}, connection={games[uid].locator('#pd-connection-status').inner_text()!r}"
            )


def notebook_debug_state(page) -> dict:
    return page.evaluate(
        """() => {
            const storage = {};
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (key?.startsWith('bel.presentation.')) storage[key] = localStorage.getItem(key);
            }
            const select = document.querySelector('#pd-note-page');
            return {
                selected: select?.value || null,
                options: select ? [...select.options].map(option => ({ value: option.value, text: option.textContent })) : [],
                title: document.querySelector('#pd-note-title')?.value || '',
                body: document.querySelector('#pd-note-body')?.value || '',
                storage,
            };
        }"""
    )


def main() -> int:
    args = parse_args()
    print("rehearsal: starting", flush=True)
    evidence = Path(args.evidence).resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    accounts = json.loads(Path(args.accounts_file).read_text(encoding="utf-8"))
    if accounts.get("mode") != "firebase-emulator":
        raise RuntimeError("The rehearsal requires the explicit Firebase Auth emulator account fixture.")
    presenter = accounts["presenter"]["uid"]
    participants = [entry["uid"] for entry in accounts["participants"]]
    outsider = accounts["outsider"]["uid"]
    requests: list[str] = []
    responses: list[tuple[int, str]] = []
    console_errors: list[str] = []
    page_errors: list[str] = []
    asset_failures: list[tuple[int, str]] = []
    all_console_errors: list[str] = []
    export_responses: list[dict] = []
    def observe_page(page):
        page.on('response', lambda response: export_responses.append({'status':response.status,'url':response.url.split('?')[0]}) if '/export.pdf' in response.url else None)
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.on('console', lambda message: all_console_errors.append(message.text) if message.type == 'error' else None)
        page.on('response', lambda response: asset_failures.append((response.status, response.url.split('?')[0])) if response.status >= 400 and '/api/' not in response.url and (response.request.resource_type in ['script', 'stylesheet', 'image', 'font'] or response.url.split('?')[0].endswith(('.js','.mjs','.css'))) else None)
    result = {"channel": args.channel, "baseUrl": args.base_url, "accounts": [presenter, *participants], "assertions": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.channel, headless=True)
        print("rehearsal: browser launched", flush=True)
        contexts = {}
        pages = {}
        games = {}
        try:
            for uid in [presenter, *participants, outsider]:
                print(f"rehearsal: opening lobby {uid}", flush=True)
                context = browser.new_context()
                context.set_default_timeout(10000)
                context.on('page', observe_page)
                if uid in participants[1:]:
                    skew=120000 if uid==participants[1] else -120000
                    context.add_init_script(f"const belOriginalNow=Date.now.bind(Date); Date.now=()=>belOriginalNow()+({skew});")
                if args.failover_url:
                    context.add_init_script(f"window.__BEL_PRESENTATION_FAILOVER_ORIGINS = [{json.dumps(args.failover_url)}];")
                context.tracing.start(screenshots=False, snapshots=False, sources=False)
                context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
                contexts[uid] = context
                page = open_lobby(context, args.base_url, accounts["presenter"] if uid == presenter else next(entry for entry in accounts["participants"] if entry["uid"] == uid) if uid in participants else accounts["outsider"])
                pages[uid] = page
                print(f"rehearsal: lobby ready {uid}", flush=True)
                page.on("request", lambda request: requests.append(request.url))
                page.on("websocket", lambda websocket: requests.append(websocket.url))
                page.on("response", lambda response: responses.append((response.status, response.url)) if "/api/presentation-demo" in response.url else None)
                page.on("console", lambda message, account=uid: console_errors.append(f"{account}: {message.type}: {message.text}") if message.type == "error" else None)

            pages[presenter].locator("#pd-create-room").click()
            wait_for_text(pages[presenter], "#pd-room", "")
            room_code = pages[presenter].locator("#pd-room-code-display").inner_text()
            room_id = parse_qs(urlparse(pages[presenter].url).query)["room"][0]
            result["roomId"] = room_id
            result["roomCode"] = room_code
            result["assertions"].append("admin-created-one-room")

            for uid in participants:
                pages[uid].locator("#pd-room-code").fill(room_code)
                pages[uid].locator("#pd-join-form").press("Enter")
                try:
                    wait_for_text(pages[uid], "#pd-room", room_code)
                except PlaywrightTimeoutError:
                    raise AssertionError(
                        f"Participant join did not render room for {uid}: error={pages[uid].locator('#pd-join-error').inner_text()!r}, "
                        f"auth={pages[uid].locator('#pd-auth-message').inner_text()!r}, url={pages[uid].url!r}"
                    )
            pages[outsider].locator("#pd-room-code").fill(room_code)
            pages[outsider].locator("#pd-join-form").press("Enter")
            pages[outsider].locator("#pd-join-error").wait_for(state="visible")
            result["assertions"].append("fifth-player-rejected")

            for uid in [presenter, *participants]:
                games[uid] = open_game(pages[uid])
                print(f"rehearsal: game ready {uid}", flush=True)
                games[uid].on("request", lambda request: requests.append(request.url))
                games[uid].on("websocket", lambda websocket: requests.append(websocket.url))
                games[uid].on("response", lambda response: responses.append((response.status, response.url)) if "/api/presentation-demo" in response.url else None)
            for uid, game in games.items():
                wait_for_text(game, "#pd-game-slots", "p0")
            result["assertions"].append("four-distinct-contexts-connected-p0-p3")

            duplicate_context = browser.new_context()
            duplicate_context.set_default_timeout(12000)
            duplicate_context.on('page', observe_page)
            if args.failover_url:
                duplicate_context.add_init_script(f"window.__BEL_PRESENTATION_FAILOVER_ORIGINS = [{json.dumps(args.failover_url)}];")
            duplicate_context.tracing.start(screenshots=False, snapshots=False, sources=False)
            duplicate_context.on("page", lambda new_page: new_page.on("websocket", lambda websocket: requests.append(websocket.url)))
            duplicate_page = open_lobby(duplicate_context, args.base_url, accounts["participants"][0])
            duplicate_page.locator("#pd-room-code").fill(room_code)
            duplicate_page.locator("#pd-join-form").press("Enter")
            try:
                wait_for_text(duplicate_page, "#pd-room", room_code)
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Duplicate join did not render room: error={duplicate_page.locator('#pd-join-error').inner_text()!r}, "
                    f"auth={duplicate_page.locator('#pd-auth-message').inner_text()!r}, url={duplicate_page.url!r}"
                )
            duplicate_game = open_game(duplicate_page, allow_existing=True)
            # The original connection is still live, so takeover is explicit.
            duplicate_game.locator("#pd-replace-connection").wait_for(state="visible")
            games[participants[0]].close()
            duplicate_game.locator("#pd-replace-connection").click()
            wait_for_text(duplicate_game, "#pd-connection-status", "Connected")
            games[participants[0]] = duplicate_game
            contexts[f"duplicate-{participants[0]}"] = duplicate_context
            pages[f"duplicate-{participants[0]}"] = duplicate_page
            result["assertions"].append("same-account-takeover-kept-one-seat")

            wait_for_text(games[presenter], "#pd-start-room", "")
            games[presenter].locator("#pd-start-room").click()
            try:
                games[presenter].wait_for_function("window.belOnlineDebug.snapshot().room.lifecycle==='playing'")
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Presenter transition did not open the route: gate={games[presenter].locator('#pd-gate').inner_text()!r}, "
                    f"message={games[presenter].locator('#pd-game-message').inner_text()!r}, "
                    f"connection={games[presenter].locator('#pd-connection-status').inner_text()!r}"
                )
            result["assertions"].append("initial-bootstrap-gate-opened-only-after-all-four")

            for uid in participants:
                game = games[uid]
                game.locator("#pd-note-title").fill(f"Observation {uid}")
                game.locator("#pd-note-body").fill(f"Private {uid} evidence with Vietnamese: hợp tác.")
                game.locator("#pd-save-note").click()
                wait_for_text(game, "#pd-note-status", "Saved")
            active_base_url = args.base_url
            active_uids = [presenter, *participants]
            for uid in active_uids:
                wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)
            physical_route(games,presenter,participants,args.base_url,room_id,evidence,result)

            # Hold one save response while typing newer content. The save
            # handler must retain the newer local draft after the old response.
            delayed_game = games[participants[0]]
            delayed_game.locator("#pd-note-title").fill("Delayed older")
            delayed_game.locator("#pd-note-body").fill("OLDER RESPONSE")
            delayed_game.evaluate(
                """() => {
                    const originalFetch = window.fetch.bind(window);
                    let releaseGate;
                    const gate = new Promise(resolve => { releaseGate = resolve; });
                    const state = {
                        seen: false,
                        released: false,
                        originalFetch,
                        release() {
                            if (state.released) return;
                            state.released = true;
                            releaseGate();
                        },
                    };
                    window.__belNotebookDelay = state;
                    window.fetch = async (...args) => {
                        const [input, init = {}] = args;
                        const request = input instanceof Request ? input : null;
                        const method = String(init.method || request?.method || 'GET').toUpperCase();
                        const url = String(request?.url || input);
                        const response = await originalFetch(...args);
                        if (!state.seen && method === 'PUT' && url.includes('/api/presentation-demo/rooms/') && url.includes('/notes/')) {
                            state.seen = true;
                            await gate;
                        }
                        return response;
                    };
                }"""
            )
            delayed_game.locator("#pd-save-note").click()
            delayed_game.wait_for_function("() => window.__belNotebookDelay?.seen === true", timeout=15000)
            delayed_game.locator("#pd-note-title").fill("Newer typing")
            delayed_game.locator("#pd-note-body").fill("NEWER RESPONSE")
            delayed_game.evaluate("() => window.__belNotebookDelay.release()")
            try:
                wait_for_text(delayed_game, "#pd-note-status", "newer edits kept", timeout=15000)
            except PlaywrightTimeoutError:
                raise AssertionError(
                    f"Delayed notebook response did not settle: intercepted={delayed_game.evaluate('window.__belNotebookDelay?.seen')}, "
                    f"status={delayed_game.locator('#pd-note-status').inner_text()!r}, "
                    f"title={delayed_game.locator('#pd-note-title').input_value()!r}, "
                    f"body={delayed_game.locator('#pd-note-body').input_value()!r}, "
                    f"message={delayed_game.locator('#pd-game-message').inner_text()!r}"
                )
            if delayed_game.locator("#pd-note-body").input_value() != "NEWER RESPONSE":
                raise AssertionError("A delayed notebook response overwrote newer typing.")
            delayed_game.evaluate(
                """() => {
                    const state = window.__belNotebookDelay;
                    if (state?.originalFetch) window.fetch = state.originalFetch;
                    delete window.__belNotebookDelay;
                }"""
            )
            result["assertions"].append("delayed-notebook-response-kept-newer-typing")

            # A new page is catalogued before its first server save. Reload the
            # lobby, reopen the game, and require both its identity and draft.
            delayed_game.get_by_role("button", name="New page").click()
            new_page_id = delayed_game.locator("#pd-note-page").input_value()
            delayed_game.locator("#pd-note-title").fill("Unsaved page")
            delayed_game.locator("#pd-note-body").fill("Unsaved Vietnamese: hợp tác")
            delayed_game.wait_for_timeout(500)
            notebook_before_reload = notebook_debug_state(delayed_game)
            delayed_game.close()
            duplicate_page.reload(wait_until="domcontentloaded")
            wait_for_text(duplicate_page, "#pd-auth-status", "Signed in", timeout=30000)
            reopened = open_game(duplicate_page)
            games[participants[0]] = reopened
            try:
                reopened.locator(f"#pd-note-page option[value='{new_page_id}']").wait_for(state="attached", timeout=15000)
                reopened.wait_for_function(
                    "([pageId, body]) => document.querySelector('#pd-note-page')?.value === pageId && document.querySelector('#pd-note-body')?.value === body",
                    arg=[new_page_id, "Unsaved Vietnamese: hợp tác"],
                    timeout=15000,
                )
            except PlaywrightTimeoutError:
                notebook_after_reload = notebook_debug_state(reopened)
                result["notebookReloadDiagnostics"] = {"before": notebook_before_reload, "after": notebook_after_reload}
                raise AssertionError(f"New unsaved notebook page did not reappear after reload: {json.dumps(result['notebookReloadDiagnostics'], ensure_ascii=False)}")
            notebook_after_reload = notebook_debug_state(reopened)
            result["notebookReloadDiagnostics"] = {"before": notebook_before_reload, "after": notebook_after_reload}
            if reopened.locator("#pd-note-body").input_value() != "Unsaved Vietnamese: hợp tác":
                raise AssertionError("New unsaved notebook page draft did not reappear after reload.")
            result["assertions"].append("new-unsaved-notebook-page-restored-after-reload")

            if args.failover_signal:
                print("rehearsal: failover checkpoint", flush=True)
                Path(args.failover_signal).write_text("ready\n", encoding="utf-8")
                wait_for_text(games[presenter], "#pd-connection-status", "Reconnecting", timeout=20000)
                wait_for_text(games[presenter], "#pd-connection-status", "Connected", timeout=30000)
                result["assertions"].append("active-backend-failover-reconnected")
                active_base_url = args.failover_url
                for uid in active_uids:
                    wait_for_text(games[uid], "#pd-connection-status", "Connected", timeout=30000)

            authoritative = {}
            for uid in active_uids:
                token = games[uid].evaluate("window.firebase.auth().currentUser.getIdToken()")
                snapshot_response = games[uid].request.get(
                    f"{active_base_url}/api/presentation-demo/rooms/{room_id}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                if snapshot_response.status != 200:
                    raise AssertionError(f"Authoritative room snapshot returned {snapshot_response.status} for {uid}")
                snapshot = snapshot_response.json()["data"]
                authoritative[uid] = {
                    "lifecycle": snapshot["lifecycle"],
                    "deck": snapshot["deck"],
                    "activity": snapshot.get("activity"),
                    "scenes": {
                        slot_id: {
                            "scene": slot.get("scene"),
                            "instanceId": slot.get("instanceId"),
                            "position": slot.get("position"),
                            "relationship": slot.get("relationship"),
                        }
                        for slot_id, slot in snapshot["slots"].items()
                        if slot.get("uid")
                    },
                }
            result["authoritativeSlideStates"] = authoritative
            reference_state = authoritative[presenter]
            if any(state != reference_state for state in authoritative.values()):
                raise AssertionError(f"Authoritative slide state did not converge: {authoritative}")
            if reference_state["lifecycle"] != "playing" or reference_state["deck"]["room"] != "J" or reference_state["deck"]["slide"] != 21:
                raise AssertionError(f"Unexpected authoritative slide state: {reference_state}")
            result["assertions"].append("server-authorized-movement-and-route-used")

            # Backend failover must not erase the active local-only page draft.
            wait_for_text(games[participants[0]], "#pd-note-body", "")
            restored_body = games[participants[0]].locator("#pd-note-body").input_value()
            if restored_body != "Unsaved Vietnamese: hợp tác":
                raise AssertionError(f"Reconnected participant lost its active unsaved page draft: {restored_body!r}")
            result["assertions"].append("reconnect-preserved-active-unsaved-page")

            games[presenter].once("dialog", lambda dialog: dialog.accept())
            games[presenter].locator("#pd-end-room").click()
            wait_for_text(games[presenter], "#pd-gate", "ended", timeout=15000)
            result["assertions"].append("explicit-end-left-terminal-room")

            for uid in [presenter, participants[0]]:
                try:
                    with games[uid].expect_download(timeout=15000) as download_info:
                        games[uid].locator("#pd-export-pdf").click()
                except PlaywrightTimeoutError:
                    result['exportDiagnostics']={'uid':uid,'message':games[uid].locator('#pd-game-message').inner_text(),'responses':export_responses}
                    raise AssertionError(f"PDF download did not finish: {result['exportDiagnostics']}")
                download = download_info.value
                target = evidence / f"{uid}-export.pdf"
                download.save_as(str(target))
                pdf = target.read_bytes()
                if not pdf.startswith(b"%PDF-"):
                    raise AssertionError(f"{uid} export is not a PDF")
                result.setdefault("pdf", {})[uid] = {"path": str(target), "bytes": len(pdf)}
            result["assertions"].append("presenter-and-participant-pdf-exports")

            participant_token = pages[participants[0]].evaluate("window.firebase.auth().currentUser.getIdToken()")
            response = pages[participants[0]].request.get(
                f"{active_base_url}/api/presentation-demo/rooms/{room_id}/notes/{participants[1]}",
                headers={"Authorization": f"Bearer {participant_token}"},
            )
            if response.status != 403:
                raise AssertionError(f"Cross-user note read returned {response.status}, expected 403")
            result["assertions"].append("participant-cross-user-notes-denied")

            # The primary HTTP server has intentionally been stopped. Load the
            # surviving gateway and authenticate the same teacher there; a
            # document reload cannot use the in-page API failover transport.
            history_page = open_lobby(contexts[participants[0]], active_base_url, accounts["participants"][0])
            result["historyBaseUrl"] = active_base_url
            history_rows = history_page.locator(".pd-history-row")
            history_rows.first.wait_for(state="visible", timeout=15000)
            current_history = history_rows.first
            current_history.get_by_role("button", name="View archive").click()
            expect(current_history.locator(".pd-history-notes")).to_contain_text("Delayed older", timeout=15000)
            history_notes = current_history.locator(".pd-history-notes").inner_text()
            if "Newer typing" in history_notes or "Unsaved Vietnamese" in history_notes:
                raise AssertionError(f"Archive exposed a local-only notebook draft: {history_notes!r}")
            result["assertions"].append("teacher-history-view-renders-readable-notes")

            if not any("/api/presentation-demo/ws" in url for url in requests):
                raise AssertionError("No authenticated presentation WebSocket was observed")
            if any("BroadcastChannel" in url for url in requests):
                raise AssertionError("Unexpected BroadcastChannel request observed")
            unexpected_console_errors = [entry for entry in console_errors if not entry.startswith(f"{outsider}:")]
            if unexpected_console_errors:
                raise AssertionError(f"Unexpected browser console errors: {unexpected_console_errors}")
            if page_errors or asset_failures:
                raise AssertionError(f"Browser runtime or asset failures: {page_errors!r}, {asset_failures!r}")
            result["assertions"].append("network-transport-observed-no-same-profile-channel")
        except Exception as error:
            result['failure'] = str(error)
            print(traceback.format_exc(), flush=True)
            (evidence / 'failure.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            raise
        finally:
            result["requestCount"] = len(requests)
            result["networkRequests"] = sorted({url.split("?")[0] for url in requests if "/api/presentation-demo" in url})
            result["expectedConsoleErrors"] = [entry for entry in console_errors if entry.startswith(f"{outsider}:")]
            result["consoleErrors"] = [entry for entry in console_errors if not entry.startswith(f"{outsider}:")][:30]
            result['pageErrors'] = page_errors
            result['assetFailures'] = asset_failures
            result['allConsoleErrors'] = all_console_errors[:80]
            for name, context in contexts.items():
                try:
                    context.tracing.stop(path=str(evidence / f"trace-{name}.zip"))
                except Exception:
                    pass
                try:
                    context.close()
                except Exception:
                    pass
            browser.close()

    (evidence / "rehearsal.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
