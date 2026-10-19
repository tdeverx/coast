# PJ-02 — admit the selected companion crop flight before process creation

Implemented in the companion plugin's existing `TrailerCropController`, with no main app caller change. The plugin tree was clean at `6bb31f18048951bf27656d0486119b7ebee2d00c` before this batch. No additional repository `AGENTS.md` was found; the session instructions apply. Only the controller and four test files changed.

`ConcurrentDictionary.GetOrAdd` may run its value factory more than once. Previously that factory called `AnalyzeAsync`, which starts FFmpeg synchronously before its first await. Losing factories therefore created real work even though their tasks were discarded. The cache now stores an inert `Lazy<Task<CropResult?>>` with `ExecutionAndPublication`. Only the **selected** Lazy is evaluated, inside the existing error handler. Failure removes the exact key/Lazy pair, so an older failed waiter cannot remove a replacement admitted after another waiter evicted the failed entry. The target .NET 10 API supports this conditional removal directly.

The shared owner is [TrailerCropController.cs](/Users/admin/Documents/ChatGPT/coast-plugin/Coast/Api/TrailerCropController.cs:19); all authenticated `POST /Coast/TrailerCrop` callers benefit. Normalization, validation, winning-request authorization/source, item-only identity, successful and null-result retention, last cropdetect match, per-waiter warning/502 response and shared 20-second analysis timeout keep their existing contracts. `AnalyzeAsync` and everything below it are byte-identical to the captured baseline. No cancellation, queue, concurrency cap, byte budget, decoder, retention or cache-key policy was introduced. PJ-03 remains separate.

## Verification

The companion Release build passed with **0 warnings and 0 errors**, using its existing pinned/cached dependencies and `--no-restore`. The dependency-free test project adds a reference to the already installed ASP.NET shared framework and links the actual production controller; small test-only Jellyfin stubs replace host interfaces. It adds no NuGet package or production dependency. Its local framework restore uses only the installed `library-packs` source.

The focused harness passes **11 existing journal checks and 20 crop checks**. Eight requests contend while analysis admission is held; one harmless child is started and all callers receive the final emitted crop rectangle. Further checks cover normalized success hits, retained null results, early-failure retry, disabled/invalid/header contracts and per-waiter failure responses. A controlled Task settlement places a replacement flight inside the first failed waiter's logger callback, then lets the second old waiter execute the real catch block. That replacement survives and completes. Test cleanup releases its gates and awaits owned request tasks before removing its disposable directory; liveness waits are bounded.

The [source-pinned regression receipt](evidence/implementation-plugin-crop-controlled.json) executes three isolated copies of the same maintained harness:

| Controller source | Eight contending requests | Result |
| --- | --- | --- |
| Exact baseline | 8 analysis admissions | Fails the admission contract |
| Current | 1 analysis admission | All 31 journal/crop checks pass |
| Current with key-only failure removal restored | 1 analysis admission | Fails replacement ownership |

The children emit authored crop diagnostics and never run FFmpeg or open media/network streams. These are controlled correctness/admission checks, **not actual-media, natural contention, CPU, memory or latency measurements**. The [probe](probes/plugin-crop-admission.py) uses temporary projects, installed framework packs and 60-second subprocess deadlines, verifies unchanged source hashes and removes its temporary projects. The maintained companion tests remain the primary drift protection.

## Actual corpus and consumer limits

Current main-app source has **no `/Coast/TrailerCrop` caller**. Its companion adapter calls `/Coast/Changes`; trailer selection uses the existing local-trailer order and direct-play eligibility in [playback service](/Users/admin/Documents/ChatGPT/coast-new/src/lib/playback/service.server.ts:728), followed by the authorized trailer stream route. Hero and persistent-player crop behavior uses the separate browser `observeVideoCrop` owner. That selection, playback, fallback and browser crop behavior was not changed. Changes/Journal hints were not touched.

The read-only retained rotating diagnostics census found zero `TrailerCrop`, trailer or crop matches; rotating logs cannot establish absence of historical or external calls. The retained authorized actual JPEG/WebP samples are still images. No authorized retained real trailer was available, and authored MP4 test fixtures cannot supply actual-media acceptance. No provider request, media download, normal/deployed database access, deployment or external write was performed.

Actual Jellyfin/FFmpeg acceptance therefore remains open: use an already authorized real retained trailer, confirm its normal crop/fallback result, then observe concurrent requests to this endpoint sharing one analysis and a real failed/retried analysis. Keep credentials and raw source identifiers private. Before claiming a main-app gain, establish an actual consumer; this patch alone does not accelerate today's main-app trailer path. Distinct-item aggregate process admission, cache retention and request cancellation still require separate policy and evidence.

The [machine report](implementation-plugin-crop.json) records exact source pins, command/build boundaries and gaps. The original PJ-02 audit remains historical; this supplement records the later implementation and controlled verification.
