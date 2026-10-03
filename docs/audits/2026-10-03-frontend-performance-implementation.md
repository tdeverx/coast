# Frontend performance implementation evidence

3 October 2026. Compared HEAD `c771fb9` with the implemented working tree. Preserved the existing markup, styles and independent feature gates.

Shelf social badges now query only missing IDs, remember queried empty results, retain previous badges during append and allow at most two concurrent 60-ID batches. Viewer, selected filters and relevant server/local social revisions invalidate the shelf-local results. Failed IDs retry on the next update; aborted/replaced/disposed requests cannot publish stale results. Journal visibility uses a Set for finite day limits and bypasses filtering for unlimited history. Global gesture scroll cancellation is installed only during a pending hold. Stable content keys replace broad page-data subscriptions in progress, experimental, social and Dynamic Feed sources; server revisions retain remote/provider refresh, and unchanged initial progress data no longer hides a new provider revision.

| Controlled workload | Before | After |
| --- | ---: | ---: |
| 5 appended 60-card pages | 15 requests / 900 IDs | 5 / 300 |
| 10 pages | 55 / 3,300 | 10 / 600 |
| 20 pages | 210 / 12,600 | 20 / 1,200 |
| Two 60-second session-only polls | 26 content requests | 0 |
| Loaded Dynamic Feed rows after polls | 2 → 1 | 2 → 2 |
| 30,000 events, seven allowed dates, synthetic median | 187.157 ms | 0.640 ms |
| 3,000 idle gestures × 2,000 fake scrolls | 6,000,000 callbacks | 0 |

Used a disposable Vite loopback fixture on `127.0.0.1:5283` with the real frontend components and stylesheet. A `git archive` copy supplied the baseline. Only SvelteKit page/navigation boundaries and deterministic GET-only API responses were substituted; there was no DB or provider connection. Cached Chromium exercised the same append workload and two controlled 60-second clock advances before/after. Desktop and mobile captures used 1440×1000 and 390×844 viewports. Browser plugin was unavailable; the Playwright skill supplied the CLI workflow.

Provider, social and explicit refreshes still fetched relevant content. The selected availability filter stayed pressed and `scope=available` remained in refreshed requests. Native right-click and Shift+F10 opened context behavior; moved touch and nested rail scroll cancelled; stationary hold opened once; the following click was suppressed once. Browser scroll-listener instrumentation measured 0 idle → 1 holding → 0 released. Final browser console had 0 errors and 0 warnings. Root independently verified session stability and provider refresh.

`bun test tests/ui-*.test.ts tests/experimental-features.test.ts`: **40 passed, 0 failed, 324 assertions in 16 files**. New regression coverage checks incremental/empty enrichment, concurrency, retry, viewer/filter/revision replacement, stale delivery/disposal, journal boundary/unknown-date/rewatch identities, gesture cleanup and domain refresh identity. The existing client test loads the actual compiled revision helper and checks mutation-domain increments. The frontend check passed with 0 errors/warnings before parallel integration; the final combined check is owned by the lead.

Evidence and reproduction details are in `/tmp/coast-frontend-implementation-report.md` and `/tmp/coast-frontend-qa/verification-results.json`. Clean before/after traces are `trace-1791045753326` and `trace-1791045896779` under the fixture's `browser/traces` directory. Screenshots: `after-refresh-desktop.png`, `after-refresh-mobile.png`.

The task fixture server and isolated browser sessions were stopped after verification. Existing dev5173 was not requested, restarted or stopped, and existing DB/provider data remained untouched. No commits, pushes, deployment or production dependencies were added. Synthetic timing results exclude browser layout, paint, media decoding and real network latency. The fixture validates real frontend component behavior; authenticated SvelteKit DB loads, server revision query cost/coverage, playback memory and native Safari remain separate scopes.
