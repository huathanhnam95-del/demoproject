"""Real controller rendering with deferred fixture responses in installed Chrome."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    try:
        page = browser.new_page()
        page.set_content('<div id="summary"></div><div id="agents"></div><select id="courses"></select>')
        for name in ("dashboard.js", "dashboard-workspace.js", "agent-sources-workspace.js"):
            page.add_script_tag(path=str(ROOT / "public/js/crm" / name))
        result = page.evaluate("""async () => {
          const queue = [];
          const request = path => new Promise((resolve, reject) => queue.push({path, resolve, reject}));
          const dashboard = CrmDashboardWorkspace.createController({
            elements: {dashboardSummaryCards: document.getElementById('summary')},
            apiFetchJson: request, escapeHtml: String
          });
          const first = dashboard.refreshDashboard();
          const second = dashboard.refreshDashboard();
          const old = queue.splice(0, 5), current = queue.splice(0, 5);
          const finish = (requests, value) => requests.forEach(r => r.resolve({summary: {counselorProductivityCount: value}}));
          finish(current, 22); await second;
          finish(old, 11); await first;
          const dashboardLatest = document.querySelector('[data-card-key="counselors"] .crm-summary-card-value').textContent;
          const failed = dashboard.refreshDashboard().catch(error => error.message);
          queue.splice(0, 5).forEach(r => r.reject(Error('Current failure')));
          const dashboardError = await failed;
          const dashboardRetained = document.querySelector('[data-card-key="counselors"] .crm-summary-card-value').textContent;

          const cache = {};
          const agent = CrmAgentSourcesWorkspace.createController({
            elements: {agentSourcesList: document.getElementById('agents')}, dataCache: cache, apiFetchJson: request
          });
          const a = agent.refresh(); await Promise.resolve();
          const b = agent.refresh(); await Promise.resolve();
          const [oldAgent, newAgent] = queue.splice(0, 2);
          newAgent.resolve({agentSources: [{agentSourceId: 'new', name: 'New result'}]}); await b;
          oldAgent.resolve({agentSources: [{agentSourceId: 'old', name: 'Old result'}]}); await a;
          const agentLatest = cache.agentSources[0].agentSourceId;
          const agentFailed = agent.refresh().catch(error => error.message); await Promise.resolve();
          queue.shift().reject(Error('Agent failure')); const agentError = await agentFailed;
          const agentRetained = cache.agentSources[0].agentSourceId;

          const courses = [];
          window.CrmCourses = {fetchCourses: () => new Promise(resolve => courses.push(resolve))};
          const courseAgent = CrmAgentSourcesWorkspace.createController({
            elements: {selectAgentCourse: document.getElementById('courses')},
            apiFetchJson: async () => ({agentSources: []})
          });
          const c1 = courseAgent.refresh(), c2 = courseAgent.refresh();
          courses[1]([{courseId: 'new-course', name: 'New course'}]); await c2;
          courses[0]([{courseId: 'old-course', name: 'Old course'}]); await c1;
          return {dashboardLatest, dashboardError, dashboardRetained, agentLatest, agentError,
                  agentRetained, courseIds: Array.from(document.getElementById('courses').options).map(o => o.value)};
        }""")
        assert result["dashboardLatest"] == "22", result
        assert result["dashboardError"] == "Current failure", result
        assert result["dashboardRetained"] == "22", result
        assert result["agentLatest"] == "new", result
        assert result["agentError"] == "Agent failure", result
        assert result["agentRetained"] == "new", result
        assert result["courseIds"] == ["", "new-course"], result
        print("PASS dashboard and agent refresh ordering, failure retention and course dropdown ordering")
    finally:
        browser.close()
