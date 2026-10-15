# Independent reading/reader performance audit

Baseline: `ea01908`, branch `codex/performance-criteria`, 2026-10-15. Read-only investigation; no production edits, DBs, providers, live files, servers, installs or browser automation. Bun 1.4.3 on this checkout. Focused synthetic operations distinguish lifecycle behavior from actual browser decoding or production resource use.

## Confirmed findings

### READ-PERF-01 — CBZ decode wait does not cancel and pending object URL is not owned by teardown

Priority P1 (resource/lifecycle reliability), high confidence. References `src/lib/reading/reader/comic.ts:18-30`, especially `:22-26`; contrast the reusable `src/lib/reading/reader/load.ts:2-16` and Reader cleanup `src/lib/reading/Reader.svelte:40`.

The first page assigns a newly allocated object URL and awaits `pageImage.decode()` directly. The engine is not returned until that finishes. Closing/minimizing aborts its controller, but no abort listener or abort-aware decoder await exists here. The variable cleaned by catch/destroy (`url`) only acquires this URL *after* decode succeeds. A pending/hung decoder therefore leaves opening pending and its URL/image alive. After an engine is returned, the same pending-URL hole exists during subsequent navigation. A stale decode rejection is also surfaced as a current failure before the epoch check at line 24.

Independent reproduction `/private/tmp/coast-perf-reader-probe.ts`: a tiny, real single-entry CBZ constructed with installed zip.js, fake DOM image with deliberately unsettled `decode()`, then AbortController.abort. Result:

```json
{"probe":"CBZ initial decode never settles","settled":"still pending after abort","allocated":1,"revoked":0,"removed":0}
```

The 30 ms race is only a controlled observation window for an indefinitely pending stub; no claim about a real decoder's timing. Existing tests test `readerLoad()` itself, not that CBZ uses it.

Smallest fix: make CBZ's decode wait use existing abort-aware `readerLoad`; explicitly own the current pending URL as soon as created and revoke it on cancel, failed/stale decode, replacement and destruction. Remove the decoding image's source on teardown where needed, then remove only this renderer's element. Avoid allowing an older completion/catch to clear a newer URL or surface a stale error. Pass abort through existing extraction and leave source permissions alone.

Meaningful regression: close/minimize during *initial and later* decode, indefinite decoder, later resolution/rejection after replacement, and repeated close. Assert prompt promise settlement, exact-once URL ownership/release, no stale changed/error callback and no removal of the new renderer's DOM.

### READ-PERF-02 — Clamped no-op page turns repeat extraction and decode

Priority P2 (unnecessary work), high confidence. References `src/lib/reading/reader/comic.ts:18-29`, `src/lib/reading/reader/pdf.ts:16-27`, and always-enabled edge navigation `src/lib/reading/Reader.svelte:52`.

At first/last page, previous/next clamp to the existing page but still extract/decode CBZ or retrieve/render PDF again. The recordReading comparison avoids a duplicate bookmark write, but expensive visual work still occurs. Repeated party requests to an already rendered location should similarly be no-ops (while resize remains an intentional rerender).

Independent reproduction `/private/tmp/coast-perf-reader-noop.ts`: tiny real one-page archive, fake immediate image decoder, wrap the real entry's getData counter. Opening plus previous/previous/next gives:

```json
{"probe":"already at first/last page","navigationCalls":3,"pages":1,"extraction":4,"decode":4}
```

Smallest fix: track successfully rendered page separately from requested page; skip exact already-settled location requests, retain retry after failure, and make PDF resize explicitly force rendering. Do not suppress a pending newer request or make current source changes share an old rendered-page identity. A cosmetic disabled-button redesign is unnecessary.

Meaningful regression: opening then repeated edge turns yields one extraction/render, valid next turn renders once, failed pages can retry, and PDF size change still redraws.

## Measured nonissues / patterns to preserve

1. Bookmark writer coalescing works: `/private/tmp/coast-perf-reader-writes.ts` compiles the actual isolated writer with a deferred synthetic api. 100 page turns while first write pending produce one concurrent request and exactly two total writes (pages 1 and 100), with unsaved=false after draining. Preserve this rather than add per-turn debounce timers or a second queue. Source `reading/client.svelte.ts:82-98`.
2. Format-specific modules are dynamically imported only by selected `reader/engine.ts`; PDF worker is renderer-owned; file digest runs in its own lazy worker with streaming chunks and worker termination in finally (`file-identity.ts`, `hash.worker.ts`). No new eager imports found.
3. Reader effect already aborts and destroys engines, disconnects its ResizeObserver and clears heartbeat on visibility/session changes (`Reader.svelte:15-40`). Do not keep a minimized renderer alive to avoid reopen latency; resource release is intentional.
4. EPUB extraction validates both declared and actual extracted size before retaining chunks, caps metadata separately, rejects duplicate paths and closes archive/writer. Existing focused tests passed; do not replace safe extraction with EPUB.js direct untrusted archive parsing.
5. zip.js 2.23's output-size stream rejects actual output exceeding the declared size before writing it (`node_modules/@zip.js/zip.js/lib/core/streams/codec-stream.js:119-128` and `zip-reader.js:1026-1094`). A simple claim that CBZ's declared size checks permit unlimited ZIP expansion would be incorrect with the pinned installed implementation. Its decoder/pixel budget remains a separate question.
6. Reading metadata transport/cache uses bounded caches and shared priority/single-flight lanes (`providers/reading.server.ts`). Canonical metadata import takes identity locks only after provider lookups and detects changed metadata before updates (`catalogue/reading.server.ts`). No per-search-card import fanout found.
7. Jellyfin reading imports process one observed item at a time and checkpoint skipped entries too (`sync/jellyfin-reading.server.ts:16-45`). Shared mappings do not substitute for account generation or file access checks.
8. File relay rechecks user ownership, connected account, exact file version and permissions per request (`reading/sessions.server.ts:102-116`). It supports single byte ranges, bounded streaming and incoming cancellation. Do not introduce cross-user/public file caching to reduce those checks.

## Verification gaps and follow-up measurement, not proven regressions

- **EPUB peak memory:** preparation retains compressed source then rebuilds up to 256 MiB stored ZIP, converts to an ArrayBuffer, and EPUB.js parses that archive. The 256 MiB extraction limit is not a total process-memory budget. `epub.ts:11-29`, `epub-archive.ts:44-52`. Large real book/browser memory evidence is absent; do not call it a leak or claim a latency improvement from moving code alone. Smallest first step is document peak boundaries, measure known synthetic archive shapes under browser tooling, then decide whether a worker or different archive handoff earns complexity.
- **CBZ pixel admission is post-decode:** `comic.ts:23-25` checks 32 MP after full image.decode. It bounds accepted images rather than pre-decode peak memory. If a strict predecode memory criterion is adopted, header inspection for supported raster formats is needed (or a demonstrated decoder-level limit); a second post-decode naturalWidth check does not solve it. No huge-image allocation was attempted in this audit.
- **PDF canvas has no explicit total-pixel cap:** DPR is capped to two and page fits host, but maxImageSize is an embedded-image threshold, not the final canvas budget. `pdf.ts:9,19-21`. Measure representative desktop/mobile/large/high-DPR hosts before choosing a total canvas cap. Cannot infer OOM from code alone.
- **Resize bursts are not frame-coalesced:** direct ResizeObserver callbacks call PDF resize, canceling previous tasks (`Reader.svelte:34-35`, `pdf.ts:17`). A shared rAF coalescer may reduce retrieval/raster churn, but actual browser resize trace required to establish impact. Do not add a second global observer or change shelf layout methods.
- **Remote range overhead:** file requests call ownedReadingSession (including getJellyfin) then call getJellyfin again and readingItem. This duplicates connection hydration per range (`sessions.server.ts:77-83,103-106`). Could pass an already verified request-local context between helpers; never skip authoritative readingItem permission/version revalidation. No query-count fixture run under this read-only phase.
- **Party publish rejection:** `publishReading`'s async loop can reject while callers invoke it without observing returned promise (`client.svelte.ts:16-27`, `Reader.svelte:29`). This is a static reliability concern for the parent playback audit to deduplicate, not an independently reproduced performance issue here.

## Proposed additions to performance criteria

- Define five lifecycle phases separately: metadata query, source authorization, identity hashing, decoder preparation, display/navigation. Measure cold open and repeat open separately; bytes, extracted bytes, pixels and peak memory are different budgets.
- Every renderer owns pending resources from creation, not only after successful decode. Cancel/close must settle waits and release pending plus displayed URLs, workers, canvases and DOM. Stale *errors* require generation fencing just as stale successful values do.
- Bound per-reader concurrent decode/render work and coalesce superseded requests. An unchanged settled page/location is a no-op; resize explicitly invalidates its display dimensions.
- Verify one writer and newest-wins bookmark drain with operation counts. A faster close that loses final position fails correctness.
- Maintain lazy format/worker loading and no file-byte server upload for local sources. Report source bandwidth separately from renderer CPU/memory.
- Preserve per-request authorization and exact source version for range relays. Reuse request-local verified context, never a permission-stale cross-request shortcut.
- Resource tests need pending initial decode, pending subsequent decode, failure/retry, replacement, minimize/resume and late callbacks. Helper-only cancellation tests do not prove integration cleanup.

## Focused checks executed

`bun test tests/reading-reader.test.ts tests/reading-archive.test.ts tests/reading-hash.test.ts tests/reading.test.ts`: **10 pass, 0 fail, 65 assertions**, 172 ms reported. Hash algorithm fixture itself ~65 ms on this host; not a production throughput figure. Three bounded synthetic probes above; each exits cleanly and touches no actual service/file. No CPU/RSS claims are made from these tiny fixtures.
