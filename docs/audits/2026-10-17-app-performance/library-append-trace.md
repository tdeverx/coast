# Library append reset — actual revision and commit trace

The signed-in normal dev trial establishes a concrete shared-owner failure: a background revision refresh reloaded only the latest page and replaced the entire accumulated Library range. After pages 1–3 accumulated 180 actual cards, a same-owner refresh of page 3 published only 60; the visible scroll sentinel then appended page 4, producing 120. A second same-owner refresh later replaced that range with page 4 alone before the sentinel appended page 5. No Library repair is adopted by this diagnostic trial.

This is a new instrumented reproduction. The earlier uninstrumented 300→180 observation remains historical; this trace does not establish its exact cause retrospectively. Both belong to **LIBRARY-APPEND-OBS-09**, overlapping UIS-03. Canonical findings and additional-observation counts are unchanged.

## Environment and method

The existing signed-in `http://localhost:5173` session used the normal catalogue. Two exact temporary patches added dev/browser-only aggregate diagnostics to the existing Library owner and the two grid footer callsites in Shelf. The [protocol](candidates/library-append-trace/protocol.md), [patch preparation manifest](candidates/library-append-trace/preparation-manifest.json), [application receipt](evidence/library-append-trace-applied.json), and [complete aggregate event receipt](evidence/library-append-trace-normal.json) retain the exact source and sequence.

Each owner logged anonymous owner/request/event ordinals, page/count, append mode, refresh-domain change booleans, request admission/start/response/commit/settle, reset and disposal. The optional Shelf patch distinguishes button and sentinel. It changed no request parameters, provider behavior, resource publication guard or data command. No identities, revision values, card titles, URLs, credentials, response bodies or SQL parameters are retained in the trace. Read-only DOM inspection compared actual primary-card href sequences in memory and retained only counts/hashes/booleans.

No tracking, catalogue, settings, notification or job command manufactured a revision. Ordinary session, presence and freshness behavior could still execute. Logging, JSON serialization and a passive abort observer add work and can perturb scheduling; these observations are functional causal evidence for this captured sequence, not production timing, CPU, heap, network or resource-SLO measurements.

## Captured sequence

The target is anonymous embedded/grid owner 5. Times are UTC; a data-owner commit means the guarded assignment was admitted, not a separate browser-paint measurement.

| Time | Trigger and request | Published owner state |
| --- | --- | --- |
| 05:20:46.143 | Initial page 1, replacement | 0→60 cards, page 1 |
| 05:21:27.103 / .827 | Footer scroll admitted sentinel page 2, append | 60→120 cards, page 2 |
| 05:21:27.963 / 05:21:28.959 | Button then admitted page 3, append | 120→180 cards, page 3 |
| 05:21:38.718 | Tracking and social revision keys changed; owner unchanged; no SSR initial payload. Refresh requested page 3 with `append=false`. | Retained 180 while request ran |
| 05:21:39.457 | Refresh response returned 60; latest-resource guard admitted replacement | **180→60**, page remains 3 |
| 05:21:39.502 / .961 | Sentinel requested page 4, append | 60→120 cards, page 4 |
| 05:22:39.133 / .898 | Another same-owner tracking/social revision refresh requested page 4 with `append=false` | **120→60**, page remains 4 |
| 05:22:39.921 / 05:22:40.286 | Sentinel requested page 5, append | 60→120 cards, page 5 |
| 05:22:42.522 | Ordinary Close | One target-owner disposal; dialog count 0 |

One semantic footer action included browser scrolling that admitted the sentinel before the button. It is not one isolated request or one page per click. The first observed reduction happened before 300 cards; no new 300-card, 20-page, plateau or bounded-memory acceptance is claimed. The observer remained open while inspecting and documenting that result, so its complete final receipt includes the second refresh sequence. Both tracking and social change booleans were true; the underlying revision fields and number of session polls are not identified by this diagnostic.

The trigger is specifically same-owner freshness, not an explicit filter/owner reset, disposal, or SSR initial-data replacement. The existing latest-request/abort mechanism admitted a current response correctly. The content semantics were wrong for an accumulated range: latest page metadata and latest-page items were treated as the whole retained result.

## Measurement correction

The initial DOM sample recorded 60 actual primary cards and no query-bearing media links, matching the data owner. An intermediate broad `a[href^="/media/"]` selector returned 123 distinct hrefs and reported prefix loss. That sample also included late social `a.friend-heads` Activity query links within cards. Its raw value remains in both receipts with `measurementAccepted=false`; **123 and its prefix flag are rejected as card measurements**.

The corrected selector counts `a.art-link[href^="/media/"]`. At 05:22:26.185 it recorded 120 primary links and loss of the original 60-card prefix, with ordered hashes retained. Independently, the owner events explicitly record 180→60→120. The [reset screenshot (private verification image)](publication.md#private-verification-images) was visually inspected; it illustrates the rendered grid, not every accumulated card or a resource plateau.

## Restoration and normal acceptance

Both temporary candidate hashes were checked before exact reverse application. The [restoration receipt](evidence/library-append-trace-restoration.json) verifies the original Library/Shelf bytes, all 27 frozen source pins and absence of diagnostic markers. Its `uninstrumentedAcceptance` field was pending at the instant of restoration and remains immutable. A separate [fresh normal-document receipt](evidence/library-append-trace-restored-normal.json) completes that check: signed in, 30 Tasks, automatic jobs paused, no dialogs/popovers/alerts and no new console warnings/errors. The [Tasks screenshot (private verification image)](publication.md#private-verification-images) was visually inspected. The current source inventory still matches the completed Activity batch; no app source or schema change remains from tracing.

## Repair options and shared ownership

The [existing options](library-append-reset.md) remain relevant. The preserving-UX path tracks the admitted page interval at the existing Library data owner, revalidates that interval under one resource generation, and atomically publishes the rebuilt ordered range. This would benefit Watch/Listen/Play/Read, rows, embedded grids, collection and profile consumers through their shared adapter. Explicit viewer/filter/privacy resets must still discard the prior range, while ordinary full-route numbered navigation must retain its one-page meaning. Similar adapters need their own semantics checked before adopting a shared abstraction.

A simple reset to page 1 uses one current read but drops browsing history and requires a scroll/focus decision. Retained-range revalidation preserves browsing but uses work proportional to admitted pages and must address ordered deletions, changing totals/ranks, deep starts, partial provider failures, stale append supersession and privacy withdrawal. A bounded retained window is a larger resource/UX change requiring decided bounds and backward rehydration. Blindly appending refresh responses or suppressing revisions would leave stale, duplicate or private state and does not satisfy the contract.

Next verification must exercise the exact selected repair with actual ordered range checks, current owner/filter generations, revision during pending append, button/sentinel overlap, full/embedded and numbered/deep starts, empty/deleted pages, failure/retry/privacy, close/reopen and available media/profile cohorts. Controlled schedules supplement those actual-data checks. No arbitrary range/resource bound, new dependency or normal mutation is chosen here.
