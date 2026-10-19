# Books, comics and physical reader audit

Completed focused implementation and available real-data acceptance on 19 October 2026. Baseline: `b90f4dd96ebcdd76f68e6c7ca770b71c824c07d3` (physical reader integration). The later [loading/preference/activity adoption](loading-and-integration.md) records the current source epoch; the [delivery investigation roadmap](investigation-roadmap.md) remains future work. The remaining app-wide audit is separate.

The normal flow now uses **Read → accessible linked file**, without an edition/file picker. Metadata-only titles retain details/tracking without Read. Shared inspection avoids a canvas/draw per scan, and Three.js construction failures and ordinary disposal share resource ownership. The preserve-all binding measurements below describe the initial audit epoch: the final user preference keeps **sanitization enabled by default**, with preserve-all/unprinted faces as its explicit opt-out. Loading feedback, background blur and admin reading sessions are documented in the later adoption record.

Numerical receipts, sample arrays, source hashes and boundaries are in [evidence.json](evidence.json). Measurements are local development observations, not production p95, hardware frame-rate or a memory plateau. No production dependency, migration, rendering-quality reduction or animation timing change was introduced.

## Coverage and actual data

| Area | Checked | Boundary |
| --- | --- | --- |
| Catalogue/cards | Reading query/hydration, availability, Shelf/MediaCard/menu/details, related/credit/issue rows and lazy ownership | Source review plus actual detail journey; no large-catalogue/every-route timing campaign |
| Entry | Shared launcher, available/reader gates, current-session resume, preview, cancellation and duplicate clicks | Actual admin journey and supplementary compiled component tests |
| Database/sources | Exact candidate query, preference, missing-file fallback, account/feature/edition fences and bookmarks | 24 native actual-copy cases; 17 normal-data read-only query plans |
| Delivery | Live item/version access, HEAD/range behavior, bounded archive transfer | 17 actual file HEADs; five downloaded CBRs; supplementary failure/limit tests |
| Raster/archive | Enumeration, inspection, splitting, every rendered face/location, cancellation and limits | Five natural CBRs; odd ZIP uses untouched actual images in controlled packaging |
| Three.js | Construction/rejection, idle, comic/hardback, turns, follower controls, minimize/close/reopen | Actual rasters and SwiftShader; no new two-account live party or hardware FPS claim |
| Desktop/mobile | Details → direct Read → minimize → resume → mobile → Escape; navigation and unchanged admin state | Authenticated normal dev, Chromium 153, 1280×800 and 390×844 |
| Local lab | Shared engine, bitmap helper/layout; tests/build | 123 regressions pass; independent lab server/auth/shelf are not newly live-audited |

The existing library/import owners refreshed reading observations; a normal manual library job was also queued, without claiming a completed full-library census. Targeted reading import admitted 17 exact-identity mappings from a then-current 23-file inventory (18 CBR/five CBZ). The final native replay observed **52 live provider IDs and 17 available saved works** as the provider library changed. All 17 saved works prepared successfully. This does not certify all 52 files or authorize filename-based mappings.

Five actual CBRs contain 24/33/24/30/24 original scans and 39,372,234–82,635,611 compressed bytes; exact hashes/sizes are in the receipt. No fabricated users, catalogue, images or provider responses count as actual-data acceptance. Controlled bookmarks, disabled/disconnected states and injected renderer failures are labelled; account mutations ran on the disposable actual-data copy. The normal browser's existing user session was not replaced. A separate in-memory admin login was logged out, and normal admin progress/history matched before/after the final journey.

Private media, complete account/source DTOs, restore dump, raw results and credentials remain outside Git. Browser plugin not available: regular Playwright supplied rendered tests; the in-app browser supplied the visible read-only detail check.

## Adopted changes

### READ-01 — direct reading at the shared action/session owner

The old launcher fetched candidate links/connections and could open a chooser. It now sends one abortable `{source:'linked'}` preparation. It resumes the current matching session, coalesces duplicate clicks, cancels changed/disposed targets and stays inert in previews. Details, catalogue menus and planning gate Read on viewer availability and reader capability. Details/tracking remain available without a file.

One bounded query selects at most 20 candidates, joining editions, this viewer's connected/enabled Jellyfin sources, provider items and positive viewer availability. It excludes identity holds/unsupported formats. Order is last prepared edition, freshest availability, source name, edition ID. Every selection still undergoes live item/identity/version checks and transactional user/feature/source/account-generation checks. Provider waits finish before locks.

Only an exact live **404** marks that availability Unknown and tries the next saved candidate. Previous freshness/account generation fence the negative update; permission/authentication/transient/identity errors remain errors. No source returns an explicit refresh/retry conflict. Bookmarks copy only within the same format/edition.

The actual final journey made **one preparation POST, zero connection/linked/search preflight calls**. It fetched the whole file again on resume because minimize releases its file owner. The 24 native cases comprise 17 actual opens and seven bookmark/access/cancellation cases: a naturally missing preferred source with controlled old-edition bookmark, same-edition resume, disabled real admin, reader Off, pre-aborted command, disconnected owner and unavailable details.

The exact new SQL was compiled in memory and profiled using read-only normal-data `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for all 17 works: 1–2 rows/query, median execution **0.671 ms**, range **0.143–2.845 ms**, zero temporary blocks. First planning was 9.352 ms, later 0.682–1.461 ms. This is candidate-selection cost, not full session/provider latency. No index was justified or added.

### READ-02 — actual Jellyfin HEAD delivery

The live download endpoint rejected HEAD with 405. Coast now falls back only for 405/501 to an authenticated one-byte GET (or the caller's explicit range), immediately cancelling the body. A valid `bytes 0-0/N` becomes HEAD 200 with full length; explicit ranges keep 206 semantics. Ignored ranges are cancelled without retaining an archive; malformed unknown totals fail explicitly. Fresh source/version checks are unchanged.

All **17 actual Coast HEADs returned 200** after repair. Supplementary tests cover both statuses, explicit/ignored ranges, cancellation and malformed totals. This repairs observed current provider behavior without introducing another transport or cached permission decision.

### READ-03 — dimension-only inspection and common bitmap lifetime

Inspection previously decoded, drew and discarded a scaled canvas for every scan just to obtain dimensions. Shared `physicalImage` now returns dimensions without that canvas/draw. Visible faces still decode/draw on demand. Settled and late-aborted bitmaps close. Coast and the local lab share this helper; Coast retains 32 Mi-pixel admission and 2048-longest-side scaling, while the lab explicitly retains its existing 100,000,000-pixel policy.

| Actual hash prefix | Scans | Old inspection median | New median | Change |
| --- | ---: | ---: | ---: | ---: |
| `9740d2a4669e` | 24 | 1077.70 ms | 1052.60 ms | −2.33% |
| `f80d9626c8d9` | 33 | 1561.95 ms | 1528.50 ms | −2.14% |
| `0bdafcc152e1` | 24 | 1167.15 ms | 1081.45 ms | −7.34% |
| `368840b883c7` | 30 | 1741.15 ms | 1631.55 ms | −6.29% |
| `397ce45a645c` | 24 | 1178.55 ms | 1153.30 ms | −2.14% |

Four alternating timed pairs/file follow one warm-up pair. Transfer, preparation, model and entrance are excluded. At this pre-padding epoch all face identities, locations, dimensions and pixel hashes matched over 50 samples/1,360 faces. The final exit failed because two deliberately induced isolated-host HMR diagnostics were misclassified as engine errors. The original receipt is retained; later harnesses classify those exact diagnostics separately.

The final policy-aware replay has **20 samples**, including warm-ups, across all five files and zero engine errors. It verifies stable complete outputs per policy, every old printed raster as an exact ordered prefix, only the actual restored tail, every original location, and the outside back cover against an independently decoded final scan/right half. Inspection creates **zero canvases/draws instead of 24–33**, closing every inspected bitmap. The final single timed pairs are mixed: the 30-scan file is adverse, **1584.1→1673.6 ms**. The consistent win is avoided inspection work; this is not an across-the-board opening-time guarantee.

Every scan is still extracted/decoded to discover dimensions; later on-demand reads can decode again. Raster quality is unchanged. This pass does not claim avoided archive traversal, decoded-byte budget or GPU-memory plateau.

### READ-04 — construction and disposal share Three.js ownership

Previously only the successfully returned renderer owned full teardown. Rejection after WebGL construction could leave allocations behind. A reverse-order cleanup registry now registers context/renderer, scene geometry/materials, textures, shadows, events, observers, frames, cascades, gestures and preloader during setup. Factory rejection and ordinary close use the same idempotent path. Disposal explicitly loses the context after removing its callbacks.

On actual rasters, an injected append failure previously retained one live context; a state-callback failure retained one context/canvas/observer and 11 tracked listeners. Both now leave **zero** of those resources. Three normal setup/dispose cycles (two comic, one hardback presentation) previously left one context live immediately after each close; current leaves zero. Baseline contexts were explicitly released after measuring to isolate comparisons. Both variants already had **zero idle draw calls** in sampled idle windows.

Tradeoff: synchronous teardown **9.7–12.0 ms** versus **0.3–2.9 ms** on SwiftShader. This improves prompt release, not animation time, and does not prove an old indefinite heap leak. Rendering/material/lighting quality and animation durations remain unchanged.

Actual-content controls pass saved page-8 entry, forward/back turns, silent external navigation and blocked follower turns. Hardback uses the same CBR rasters, not an actual PDF/book. These control receipts predate the tail policy; final real-raster/back-cover and signed-in lifecycle checks cover the adopted policy separately.

### READ-05 — approved unprinted binding faces

Current adoption: this behavior is the **Off** mode of the default-on **Sanitize odd page counts** user preference; see [the later acceptance record](loading-and-integration.md). The results below retain their original preserve-all source/policy epoch.

Odd-face trimming was intentional, as clarified by the user. Replacing it is an **approved behavior change**, not an accidental-bug finding. Every scan/half now remains, with unprinted faces completing an even, minimum-four-face binding. Spares go before the actual back cover or final wraparound pair, preserving the outside back cover. They have no source location or invented progress page. PDF retains its separate existing padding policy.

Final actual face counts are **24→26, 34→34, 24→26, 30→30, 24→26**. Changed files restore the intentionally trimmed final half and add a spare: two more physical faces, not saved rendering work. Original page totals remain unchanged. A controlled ZIP of three untouched actual images verifies `[page 1, page 2, unprinted, page 3]`, with the final image hash matching its source. Supplementary tests cover short/odd counts, split mapping, resume and blank locations.

## Tried and rejected

### READ-X1 — native archive micro-batching/index ordering

Grouping concurrent native reads, ordering indices and sharing duplicate extraction reduced required-face worker packets **seven→one**, preserving per-request pixels. Four alternating real-file entry pairs (archive, inspection, required textures/model and unchanged entrance; provider/download excluded) were adverse: baseline median **3932.15 ms**, candidate **4001.20 ms**, **+1.76%**, with a **6148.1 ms** candidate sample.

The candidate was reverted. Production archive protocol/worker files remain baseline; its [patch](candidates/native-archive-batching.patch) and receipts remain for future investigation. Packet reduction alone did not justify adoption. Uninvestigated stages take priority over retrying this method.

## Remaining pain points and options

These are the focused follow-up checklist, not undisclosed claims of completed acceptance. No speculative cache/service/dependency was added.

| ID / priority | Observation/gap | Options and next acceptance gate |
| --- | --- | --- |
| READ-06 / high | Final normal-dev open **10.79 s**, resume **10.44 s**, one observation each; earlier 11.20/12.78 s. Minimize releases the compressed blob and resume downloads again. | Attribute transfer/inspection/shader/model/entrance separately. Consider bounded session-owned compressed reuse only with explicit byte/expiry/privacy ownership and close/account-change release. Compare bytes, complete latency and actual retained memory. Retaining this corpus costs 39–83 MB/file, up to the existing 128 MiB cap. These observations are not matched before/after results. |
| READ-07 / high | Five sampled natural CBZs are **401,719,147–634,573,029 bytes**, all beyond the 128 MiB compressed cap; bounded acquisition correctly rejects them. | Preserve the cap. Consider operational splitting/repacking, validated streaming enumeration/manifest, or selected-page delivery. A server-backed design adds storage/auth/lifecycle complexity and needs review plus real near-limit memory/transfer/cancellation tests. Raising the cap alone is not adopted. |
| READ-08 / medium | Visible Comic Vine artwork works, but anonymous canvas palette sampling hits CORS on the actual detail journey. | Review shared artwork-colour policy: explicit fallback or bounded authorized representation, without unbounded per-card proxies/downloads. No reader exception observed; console is not claimed fully clean. |
| READ-09 / medium | Pixel admission happens after bitmap decode. Canvas/texture counts do not prove a byte budget or memory plateau; required faces may decode concurrently. | Measure real peak decode/heap/GPU usage, repeats and large scans before choosing header preflight, decode reuse or byte budgets. Preserve cancellation and pixels; do not infer OOM/leak from elapsed time. |
| READ-10 / later | No usable natural PDF/EPUB/CB7/CBT or sampled within-cap CBZ; narrow desktop viewport/SwiftShader instead of mobile hardware. | Admit actual documents/devices. Keep fixtures separate. Check hardware frame pacing, accessibility/reduced motion, large/corrupt/slow files and simultaneous two-account live party. |
| READ-X1 / later | Native batching reduced packets but worsened observed entry. | Keep baseline; require complete-operation/resource gains before retrying. |
| LAB-01 / later | Shared engine/helper/layout pass; independent lab flat-reader/server/session paths were not newly live-audited. | Exercise pagehide/background/proxy/flat behavior if the local lab remains a priority; keep it outside production. |

No additional per-card loader, index, scheduler or speculative memoization was justified by the small actual reading catalogue. Shared hydration remains 60 cards/page, identities remain batched and supplemental rows demand loaded. The production manifest keeps format engine/physical reader/PDF modules outside static route entry imports. Existing input/expanded/page/count/decoder budgets remain in their owners. This is not certification of every possible provider file or workflow.

## Verification and reproduction

Final gates: **859 app tests pass, 716 guarded skips, zero failures; 123 lab tests pass**. Type checking has zero errors/warnings. Production/lab builds, navigation patch check, 34-module source style, code/UI inventory and whitespace pass. Guarded database skips are not actual-data acceptance; the 24 native copy cases and 17 normal read-only plans are separate.

- `scripts/reading-performance.ts`: hash/size-admitted actual files, alternating full-raster/policy oracle, renderer rejection/lifecycle, actual turns and controlled odd-image packaging.
- `scripts/fixtures/reading-renderer.ts`: browser probes with actual rasters/Three.js; failure/follower controls labelled.
- `scripts/reading-performance-native.ts`: native access/bookmark/session checks; refuses database names outside `coast_reading_audit_…`. Use an owned disposable actual-data restore, existing encrypted-data directory and authorized live provider. Never normal/production data; no worker runs on the copy.

The private file manifest is an array of `{file, sha256, bytes, format, kind}`; native bookmark checks additionally need actual saved-work `id` and verified `totalPages`. Acquire through authorized authenticated downloads; do not seed fake catalogue records. Freeze original reader source at the baseline into an ignored private checkpoint, expose only a task-owned source copy below `/src/lib/reading/reader-audit-baseline/`, and remove it before inventory/build. Never expose `.data` through Vite. Dependencies must match the frozen baseline; this run uses the unchanged lockfile.

```sh
COAST_READING_ACTUAL_MANIFEST=/absolute/private/corpus.json \
COAST_READING_AUDIT_OUTPUT=/absolute/private/result.json \
COAST_READING_BASELINE_MODULE=/src/lib/reading/reader-audit-baseline/physical-pages.ts \
COAST_READING_AUDIT_ROUNDS=4 \
bun scripts/reading-performance.ts
```

Use `COAST_READING_AUDIT_KIND=renderer`, `turns`, `padding` or `entry` for targeted probes. Timed trials run serially; `round:-1` is warm-up. The temporary loopback file/source host uses a random admitted-file path and blocks WebSockets. It separates two exact induced HMR diagnostics from engine errors. Browser/server/instrumentation/renderer owners are released after testing.

Instrumentation failures are retained separately: denied private-filesystem Vite import, cross-loopback Private Network Access rejection, interrupted base64 transport, missing renderer host, pre-hydration UI click and ambiguous Read selector. They were corrected without weakening security limits and rerun. The old strict-equivalence oracle also rejected approved padding differences; its replacement requires the complete old printed prefix, independently decoded actual tail/back cover and truthful full locations, rather than hiding differences.

The disposable actual-data database and source-only baseline are removed after acceptance. Ignored private media/checkpoint/receipts remain for reproduction. Lab import/layout adaptations remain local because the lab is ignored. No credential is printed/saved. The initial audit was uncommitted; the later requested PR also includes the [loading/preference/integration changes](loading-and-integration.md).

## Drift checklist

- [ ] New routes/actions reuse shared launch and viewer availability/capability gates; no normal picker/per-card source discovery returns.
- [ ] Source policy changes retain exact identity, live permission, account/freshness and bookmark fences; rerun native actual-copy checks.
- [ ] Decoder/layout changes replay complete actual pixels/locations, spare-face policy and actual outside back cover; retain adverse results.
- [ ] New renderer allocations immediately register teardown; rejected setup and repeated close return tracked resources to zero.
- [ ] Compare complete operations and bytes/decodes/draws, not just packet/query counts; keep source/policy/data epochs distinct.
- [ ] Admit missing formats/devices/providers before calling them accepted; prioritize READ-06/07 and unmeasured stages before READ-X1.
- [ ] Update [performance.md](../../performance.md), this report and aggregate receipts together; never publish private payloads/media/credentials.
