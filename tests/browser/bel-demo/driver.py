"""Real Chrome input; the app diagnostic surface is observation-only."""
import json, math, time
from pathlib import Path

class Driver:
    def __init__(self, browser, evidence):
        self.browser=browser; self.context=browser.contexts[0]; self.evidence=Path(evidence)
        self.evidence.mkdir(parents=True,exist_ok=True); self.pages={}; self.events=[]; self.errors=[]
        for page in self.context.pages:
            if 'actor=' in page.url:
                actor=page.url.split('actor=')[1][:2];self.pages[actor]=page
                page.on('pageerror',lambda e,a=actor:self.errors.append({'actor':a,'error':str(e)}))
        self.log('connected',version=browser.version,roles=list(self.pages))
    def log(self,event,**data):
        row={'time':time.time(),'event':event,**data};self.events.append(row)
        with (self.evidence/'chrome-events.jsonl').open('a',encoding='utf8') as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
        print(event,json.dumps(data,ensure_ascii=False),flush=True)
    def snap(self,actor):return self.pages[actor].evaluate('window.belDebug.snapshot()')
    def player(self,actor):return self.snap(actor)['world']['players'][actor]
    def wait(self,actor,condition,timeout=12000):self.pages[actor].wait_for_function(condition,timeout=timeout)
    def shot(self,actor,name):
        self.pages[actor].screenshot(path=str(self.evidence/(name+'.png')));self.log('screenshot',actor=actor,name=name)
    def focus(self,actor):
        page=self.pages[actor];page.bring_to_front();page.locator('#world').focus()
    def keys(self,actor,keys,seconds):
        page=self.pages[actor];self.focus(actor)
        for k in keys:page.keyboard.down(k)
        page.wait_for_timeout(seconds*1000)
        for k in keys:page.keyboard.up(k)
        page.wait_for_timeout(110)
        self.log('keys',actor=actor,keys=keys,seconds=seconds,position={k:self.player(actor)[k] for k in ['x','y','scene']})
    def walk(self,actor,x,y,tolerance=7,timeout=14):
        self.focus(actor);page=self.pages[actor];start=time.monotonic();last=None;stuck=0
        while time.monotonic()-start<timeout:
            p=self.player(actor);dx=x-p['x'];dy=y-p['y']
            if math.hypot(dx,dy)<=tolerance:return
            keys=[]
            if abs(dx)>tolerance/2:keys.append('d' if dx>0 else 'a')
            if abs(dy)>tolerance/2:keys.append('s' if dy>0 else 'w')
            duration=min(.13,max(.04,math.hypot(dx,dy)/(165 if p['ride'] else 108)*.72))
            for k in keys:page.keyboard.down(k)
            page.wait_for_timeout(duration*1000)
            for k in keys:page.keyboard.up(k)
            page.wait_for_timeout(85)
            pos=(round(p['x']),round(p['y']))
            stuck=stuck+1 if pos==last else 0;last=pos
            if stuck>12:break
        p=self.player(actor);raise AssertionError(f'{actor} cannot walk to {(x,y)} from {(p["x"],p["y"])} in {p["scene"]}; state={self.snap(actor)["status"]}; prompt={page.locator("#prompt").inner_text()}')
    def path(self,actor,*points):
        for point in points:self.walk(actor,*point)
    def interact(self,actor,point=None):
        self.focus(actor);page=self.pages[actor]
        if point:
            b=page.locator('#world').bounding_box();page.mouse.click(b['x']+point[0]*b['width']/1000,b['y']+point[1]*b['height']/480)
        else:page.keyboard.press('f')
        page.wait_for_timeout(420)
        self.log('interact',actor=actor,point=point,prompt=page.locator('#prompt').inner_text())
    def close_panel(self,actor):
        self.pages[actor].keyboard.press('Escape');self.pages[actor].wait_for_timeout(130)
    def enter(self,actor,scene,point=None):
        self.interact(actor,point);self.pages[actor].get_by_role('button',name='Enter',exact=True).click()
        self.wait(actor,f'document.body.dataset.scene === "{scene}" && document.body.dataset.ready === "true"')
        self.log('entered',actor=actor,scene=scene)
    def checkpoint(self,name):
        states={a:self.snap(a) for a in self.pages}
        record={'name':name,'sameSession':len({s['session']['id'] for s in states.values()})==1,'states':states,'errors':self.errors}
        (self.evidence/f'checkpoint-{name}.json').write_text(json.dumps(record,indent=2,ensure_ascii=False),encoding='utf8');self.log('checkpoint',name=name,errors=self.errors)
