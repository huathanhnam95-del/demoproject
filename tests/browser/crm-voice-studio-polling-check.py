"""Installed-Chrome voice polling regressions; no provider, recording or file output."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def run_case(browser, scenario):
    page = browser.new_page()
    page.set_content("""
      <span id="vc-worker-status-badge"></span>
      <button id="btn-vc-worker-refresh">Refresh</button>
      <button id="btn-vc-queue-trigger">Process</button>
      <textarea id="vc-studio-text-input">A fixture sentence.</textarea>
      <button id="btn-vc-studio-synthesize">Synthesize</button>
      <span id="vc-studio-status"></span>
      <div id="vc-studio-output-box" style="display:none"></div>
    """)
    page.add_script_tag(path=str(ROOT / "public/js/crm/voice-cloning-workspace.js"))
    page.evaluate("""async scenario => {
      window.auditTimers = [];
      window.auditCalls = [];
      window.auditToasts = [];
      window.setTimeout = callback => (auditTimers.push(callback), auditTimers.length);
      window.setInterval = () => 1;
      let statusCalls = 0;
      window.auditController = CrmVoiceCloningWorkspace.createController({
        showToast: text => auditToasts.push(text),
        apiFetchJson: async url => {
          auditCalls.push(url);
          if (url.endsWith('/status')) {
            if (++statusCalls > 1) throw Error('Worker status unavailable');
            return {worker: {ready: true}};
          }
          if (url.endsWith('/profiles')) return {profiles: []};
          if (url.endsWith('/latest-test')) return {};
          if (url.endsWith('/synthesize')) return {jobId: 'isolated-job'};
          if (url.includes('/jobs/')) {
            if (scenario === 'http-error') throw Error('Status request failed');
            if (scenario === 'timeout') return {status: 'running'};
            return {status: scenario === 'completed' ? 'completed' : 'failed',
                    error: 'Worker failed'};
          }
          throw Error('Unexpected fixture request: ' + url);
        }
      });
      await auditController.activate();
    }""", scenario)
    try:
        if scenario == "worker-status-error":
            page.evaluate("() => auditController.loadWorkerStatus()")
            assert page.locator("#btn-vc-queue-trigger").is_disabled()
            assert "unavailable" in page.locator("#vc-worker-status-badge").inner_text().lower()
        else:
            page.locator("#btn-vc-studio-synthesize").click()
            assert page.locator("#btn-vc-studio-synthesize").is_disabled()
            outcome = page.evaluate("""async () => {
              try {
                for (let i = 0; auditTimers.length && i < 61; i++) {
                  await auditTimers.shift()();
                }
                return {rejection: null, pending: auditTimers.length};
              } catch (error) { return {rejection: error.message}; }
            }""")
            assert outcome.get("rejection") is None, outcome
            assert outcome["pending"] == 0, outcome
            assert page.locator("#btn-vc-studio-synthesize").is_enabled()
            status = page.locator("#vc-studio-status").inner_text()
            assert ("complete" if scenario == "completed" else "error") in status.lower(), status
    finally:
        page.evaluate("() => auditController.dispose()")
        page.close()


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            for case in ("failed", "http-error", "timeout", "completed", "worker-status-error"):
                run_case(browser, case)
                print(f"PASS {case}")
        finally:
            browser.close()
