"""Real Chrome input; the app diagnostic surface is observation-only."""
import json
import math
import sys
import time
from pathlib import Path

from evidence import EvidenceCollector, redact_data, redact_text

class Driver:
    def __init__(self, browser, evidence, pages=None, collector=None):
        self.browser = browser
        self.context = browser.contexts[0] if browser and getattr(browser, 'contexts', None) else None
        self.evidence = Path(evidence)
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.collector = collector or EvidenceCollector(self.evidence)
        self.pages = pages or {}
        self.events = self.collector.events
        self.errors = self.collector.console_errors

        if not self.pages and self.context:
            for page in self.context.pages:
                if 'actor=' in page.url:
                    actor = page.url.split('actor=')[1][:2]
                    self.pages[actor] = page
                    self.collector.attach_to_page(page, actor)
        else:
            for actor, page in self.pages.items():
                self.collector.attach_to_page(page, actor)

        version = getattr(browser, 'version', 'unknown') if browser else 'mock'
        self.log('connected', version=version, roles=list(self.pages))

    def log(self, event, **data):
        return self.collector.log_event(event, **data)

    def snap(self, actor):
        return self.pages[actor].evaluate('window.belDebug.snapshot()')

    def player(self, actor):
        return self.snap(actor)['world']['players'][actor]

    def wait(self, actor, condition, timeout=12000):
        self.pages[actor].wait_for_function(condition, timeout=timeout)

    def shot(self, actor, name):
        page = self.pages.get(actor)
        return self.collector.shot(page, actor=actor, name=name)

    def focus(self, actor):
        page = self.pages[actor]
        page.bring_to_front()
        page.locator('#world').focus()

    def keys(self, actor, keys, seconds):
        page = self.pages[actor]
        self.focus(actor)
        for k in keys:
            page.keyboard.down(k)
        page.wait_for_timeout(seconds * 1000)
        for k in keys:
            page.keyboard.up(k)
        page.wait_for_timeout(110)
        self.log('keys', actor=actor, keys=keys, seconds=seconds, position={k: self.player(actor)[k] for k in ['x', 'y', 'scene']})

    def walk(self, actor, x, y, tolerance=7, timeout=14):
        self.focus(actor)
        page = self.pages[actor]
        start = time.monotonic()
        last = None
        stuck = 0
        while time.monotonic() - start < timeout:
            p = self.player(actor)
            dx = x - p['x']
            dy = y - p['y']
            if math.hypot(dx, dy) <= tolerance:
                return
            keys = []
            if abs(dx) > tolerance / 2:
                keys.append('d' if dx > 0 else 'a')
            if abs(dy) > tolerance / 2:
                keys.append('s' if dy > 0 else 'w')
            duration = min(0.13, max(0.04, math.hypot(dx, dy) / (165 if p['ride'] else 108) * 0.72))
            for k in keys:
                page.keyboard.down(k)
            page.wait_for_timeout(duration * 1000)
            for k in keys:
                page.keyboard.up(k)
            page.wait_for_timeout(85)
            pos = (round(p['x']), round(p['y']))
            stuck = stuck + 1 if pos == last else 0
            last = pos
            if stuck > 12:
                break
        p = self.player(actor)
        if math.hypot(x - p['x'], y - p['y']) <= tolerance:
            return
        try:
            prompt = page.locator("#prompt").inner_text(timeout=500) if hasattr(page, 'locator') else ''
        except Exception:
            prompt = ''
        try:
            status = self.snap(actor).get('status', 'unknown') if callable(getattr(self, 'snap', None)) else 'unknown'
        except Exception:
            status = 'unknown'
        raise AssertionError(f'{actor} cannot walk to {(x, y)} from {(p["x"], p["y"])} in {p["scene"]}; state={status}; prompt={prompt}')

    def path(self, actor, *points):
        for point in points:
            self.walk(actor, *point)

    def interact(self, actor, point=None):
        self.focus(actor)
        page = self.pages[actor]
        if point:
            b = page.locator('#world').bounding_box()
            page.mouse.click(b['x'] + point[0] * b['width'] / 1000, b['y'] + point[1] * b['height'] / 480)
        else:
            page.keyboard.press('f')
        page.wait_for_timeout(420)
        try:
            prompt = page.locator('#prompt').inner_text(timeout=500) if hasattr(page, 'locator') else ''
        except Exception:
            prompt = ''
        self.log('interact', actor=actor, point=point, prompt=prompt)

    def close_panel(self, actor):
        self.pages[actor].keyboard.press('Escape')
        self.pages[actor].wait_for_timeout(130)

    def enter(self, actor, scene, point=None):
        self.interact(actor, point)
        self.pages[actor].get_by_role('button', name='Enter', exact=True).click()
        self.wait(actor, f'document.body.dataset.scene === "{scene}" && document.body.dataset.ready === "true"')
        self.log('entered', actor=actor, scene=scene)

    def checkpoint(self, name):
        states = {}
        for a in self.pages:
            try:
                states[a] = self.snap(a)
            except Exception as exc:
                states[a] = {'error': str(exc)}
        return self.collector.checkpoint(name, states, self.errors)

    def close(self):
        try:
            if self.context:
                self.context.close()
            elif self.browser:
                self.browser.close()
        except Exception:
            pass

