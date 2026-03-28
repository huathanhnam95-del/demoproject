Browser checks in this folder use Playwright directly. `reading-journey-quiz-browser-check.js`
starts its own local harness server so it can mount the Reading Journey frontend in isolation and
stub only the APIs needed for the assessment flow.

`rfib-mode-browser-check.js` also supports an external smoke mode. Set `BASE_URL` or pass
`--base-url https://example.com` together with `--no-server` to skip the local `server.js`
startup and run the same RFIB flow against preview or live hosting.
