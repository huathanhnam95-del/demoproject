import json
import sys
from playwright.sync_api import sync_playwright


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        token_responses = []
        page.on(
            "response",
            lambda response: token_responses.append(response.status)
            if response.url.endswith("/api/local/admin-token")
            else None,
        )
        page.goto(base_url, wait_until="domcontentloaded")
        page.wait_for_function(
            """() => Boolean(window.firebaseAuthFunctions?.getCurrentUser?.())""",
            timeout=15000,
        )
        result = page.evaluate(
            """() => ({
              authenticated: Boolean(window.firebaseAuthFunctions?.getCurrentUser?.()),
              entryDisplay: getComputedStyle(document.getElementById('entry-modal')).display,
              authDisplay: getComputedStyle(document.getElementById('auth-overlay')).display,
              guestMode: Boolean(window.isGuestMode)
            })"""
        )
        admin_check = page.evaluate(
            """async () => {
              const user = window.firebaseAuthFunctions?.getCurrentUser?.();
              const token = await user?.getIdToken?.(true);
              const response = await fetch('/api/admin/status', {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
              });
              return {
                status: response.status,
                body: await response.json().catch(() => ({}))
              };
            }"""
        )
        result["tokenResponses"] = token_responses
        result["adminStatus"] = admin_check["status"]
        result["isAdmin"] = admin_check["status"] == 200 and admin_check["body"].get("isAdmin") is True
        print(json.dumps(result))
        assert result["authenticated"]
        assert result["entryDisplay"] == "none"
        assert result["authDisplay"] == "none"
        assert result["guestMode"] is False
        assert 200 in result["tokenResponses"]
        assert result["isAdmin"]
        browser.close()


if __name__ == "__main__":
    main()
