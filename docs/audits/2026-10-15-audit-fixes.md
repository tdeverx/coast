# Audit fixes — 15 October 2026

Outcome: **fixed locally**, with the deployment acceptance limits below. This pass addresses the eight findings from the sharing/reading audit and the confirmed extensions found by the independent regression review. It does not commit, publish or deploy the pending feature work.

## Changes

- Shared replay stops the actual current viewer encoder before creating a replacement. Known failed owner cleanup must drain first; failures keep their durable retry flag. A stale preparation snapshot cannot retire the wrong session or leave its current encoder untracked.
- Reducing a shared budget commits deterministic evictions before returning an over-capacity error. The earliest admitted viewers that fit remain; new arrivals cannot displace them. Provider cleanup occurs outside the allocation transaction.
- Durable request leases fence in-flight resource dispatches before replay, stop or bitrate handoff retires an encoder. Requests remain parallel, bounded to eight dispatches per viewer. The dispatch deadline ends at response headers, so ordinary body streaming retains its existing lifecycle. Expired crash leases are cleaned up. Migration `0051_shared_request_leases.sql` was tested only in disposable databases during this pass.
- Idle reading parties accept invited joins without requiring a file for media that is no longer selected. Active reading parties retain their exact-edition and controller checks.
- Reading Library navigation preserves source, availability and Reading filters instead of silently changing them on reload.
- Profile Available favourites use the shared work-availability predicate, including accessible games and albums with accessible tracks. Availability remains viewer-scoped and excludes disconnected or other-user sources.
- For You title links and their destination use one shared kind vocabulary, including books and comics.
- EPUB extraction counts actual decoder output before retaining chunks, with per-entry, aggregate and metadata limits. EPUB.js receives a rebuilt stored archive of verified bytes rather than decoding the original archive again. Local files and remote files share the compressed-size cap.
- Every supported EPUB chapter receives CSP in a direct head placed before its body, including missing, nested and late-head inputs. Rejected chapters clear the library's section cache; load/navigation errors settle rather than leaving a pending display. Script-disabled frames and legitimate chapter/assets rendering remain intact.

The sharing changes are in `src/lib/sharing`, the common playback forwarding boundary, its API error path and the database schema/migration. Reading renderer fixes are in `src/lib/reading/reader`. Filter and availability fixes remain in their existing route/query owners; they do not introduce alternative UI loaders.

## Verification

Run with the repository's bundled Bun on PATH:

- `bun run check`: zero errors or warnings.
- `bun test tests`: 393 passed, 534 skipped, zero failed. Database tests are intentionally skipped by this default command.
- `bun scripts/test-database.ts sharing-db.test.ts reading-sessions-db.test.ts profile-db.test.ts collection-db.test.ts public-api-db.test.ts reading-db.test.ts reading-sync-db.test.ts`: 100 passed in fresh, separate disposable databases. The isolated test container was returned to its original stopped state.
- `bun run build`: passed.
- `bun run code:inventory`: no unused modules.
- `bun run ui:inventory:check`: passed; 63 components verified.
- `git diff --check`: passed.

Focused sharing regressions cover six repeated replays, failed cleanup, stale snapshots, lowering a three-viewer budget to one, delayed in-flight requests during replay and quality changes, and expired crash leases. These demonstrate that the original sequential resource accumulation and all-viewer renewal failure do not reproduce, while reopening/history, native cookie-free resources and normal budget admission continue to work.

Focused archive tests cover actual chunk and aggregate limits, cancellation and an unchanged legitimate archive. An isolated in-app-browser fixture rendered ordinary, headless, late-head and nested-head EPUB chapters through the actual Coast reader. It confirmed sandbox/CSP presence, blocked test network images, rejected an unsupported opening chapter promptly, and rejected the actual EPUB.js section on both initial load and retry. No live service credentials or personal documents were involved.

## Feature status and remaining acceptance

Books and comics remain independent opt-in experiments. Their local implementation includes metadata, shared Search/Discover/Library, canonical cards/details, tracking/history, PDF/EPUB/CBZ readers, reading parties and scoped public API/webhook support. These changes remain part of the pending local feature work; this fix pass is not a production release.

Real documents, the deployment's Comic Vine key and live Jellyfin book/download configuration still need acceptance testing. Richer author/series entities, additional formats and unresolved edition/issue equivalence remain on the roadmap. See [reading](../reading.md).

Reusable playback sharing is also implemented locally. Actual VRChat/AVPro/Quest, public HTTPS topology, music handoffs and production-load behavior still need acceptance testing. Browser-to-game timeline sync remains parked. See [shared experiences](../synced-experiences.md). No live database or container was modified during this fix pass.
