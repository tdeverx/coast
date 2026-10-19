# Reading, playback and provider-read implementation

17 October 2026. Changes are in the shared working tree against audited baseline `eb0673873462b71118d1c11678d128958a05ff07`; no commit, push, deployment or production dependency was added. Baseline findings remain unchanged so the investigation and implementation evidence stay distinguishable. This implementation changed no reading/player design and performed no normal/deployed database mutation or credential extraction. Root owns final full checks and actual-data browser acceptance.

## Implemented common owners

| Finding | Change | Consumer contract |
| --- | --- | --- |
| LIVE-02 | `reading/client.svelte.ts` builds the Jellyfin command from exactly source/connectionId/externalId. The existing strict local/Jellyfin schema moved unchanged into `reading/model.ts`, consumed by the server and regression test | Single linked auto-choice, multiple linked choices, detail/menu/planning Read and future richer DTOs all pass through the same command projection. Display format never overrides provider-derived format. Unknown command fields remain rejected |
| PR-01 | `reader/epub-resources.ts` owns exact asset and rewritten-CSS Blob URL values per book; `epub.ts` installs it before opening and disposes it on every existing abort/error/close path | Existing EPUB.js instance replacement boundary is wrapped before its first automatic resource requests. Destruction revokes the owned set once; allocations completing after destruction are revoked immediately. Independent books are untouched. No global URL override or dependency patch is used by application code |
| PR-03 | `Reader.svelte` admits one visible heartbeat at a time and passes its presentation controller signal | Repeated minute ticks cannot stack requests while delivery is pending. Minimize, close, replace and teardown abort the request; a terminal late result cannot close a replacement reader. Existing visible-only minute cadence remains |
| PR-04, partial | Request signals now reach music browse/detail, artwork permission checks, trailer discovery/listing/playback-info, full/lazy library music, primary/fallback music search and source detail SSR | Existing adapter/queue/persistence signal paths are reused. Canceled provider work is not turned into an ordinary browse failure/retry. Mutation acknowledgement and media stream lifetimes were not given a new generic timeout |
| PR-07, partial | `ComicDecoder` indexes descriptors by physical archive index and clears that map on close | Natural display ordering still resolves the exact physical page. Descriptor lookup is O(1), with a bounded metadata-index allocation. Native rewind/replay cost for adversarial physical ordering is unchanged |
| PR-10 | Playback relay selects only the provider external identity it uses | HLS/segment/HEAD relay no longer materializes full provider snapshots per request. Existing session, account-generation, permission and resource-capability checks remain |
| PR-12, partial | Both video consumers give crop analysis a separate reactive lifetime from their retained media source | Hero analysis stops when hidden, backgrounded or paused. PersistentPlayer analysis stops when crop is off, browsing, backgrounded, paused, inactive, audio-only or without a source. Timer/canvas ownership ends without reloading or discarding the retained source/position |

The EPUB adapter deliberately contains the installed library integration in one module. Its behavior is protected by an actual installed `Book.open` regression, not just a mock of its public types. Dependency changes must keep that test passing or update this common owner after reviewing allocation behavior. The lifecycle still uses the current library's own book/rendition disposal; this does not replace the reading engine.

The heartbeat now bounds outstanding work but does not invent a global request deadline or change final bookmark/write acknowledgement. PR-02's wider deadline/recovery contract remains separate.

## Exact source coverage of this implementation

- Reading owner: `src/lib/reading/model.ts`, `sessions.server.ts`, `client.svelte.ts`, `Reader.svelte`, `reader/epub.ts`, new `reader/epub-resources.ts`, `reader/archive-decoder.ts`.
- Music/provider owner: `src/lib/music/service.server.ts`, `artwork.server.ts`; `src/lib/providers/jellyfin/adapter.server.ts`; `src/lib/playback/service.server.ts`.
- API callers: `src/lib/server/api/providers.server.ts`, `media.server.ts`, and the library signal call in `index.server.ts`.
- Shared browse callers: `src/lib/server/queries/music.ts`, `media-rows.ts`, `library-content.ts`, `search.ts`.
- Route callers: `src/routes/library/+page.server.ts`, `music/+page.server.ts`, `music/[connection]/[id]/+page.server.ts`, and the music-search signal call in `search/+page.server.ts`. The coordinator subsequently owns broader search demand changes; the signal contract must remain.
- Crop-analysis consumers: `src/lib/ui/heroes/playback.svelte.ts` and `src/lib/ui/components/PersistentPlayer.svelte`. Both continue using the same `observeVideoCrop` algorithm; only admission/disposal lifetime changed. PersistentPlayer uses its existing mount/teardown owner for one foreground visibility listener.

Eight test files were added/changed: `tests/media-lifecycle-client.test.ts`, new `reading-epub-resources.test.ts` and its `fixtures/epub-resources.ts`, new `provider-read-cancellation.test.ts` and its fixture, the existing `detail-route-errors.test.ts` harness, plus new `video-crop-lifecycle.test.ts` and its fixture. Existing archive/renderer/navigation/music tests were retained.

## Focused verification

Combined final focused run: **62 pass, 0 fail, 358 assertions across12 files**, Bun1.4.3. Exact output: [implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt). `git diff --check` also passed at the implementation checkpoint. No whole-project build/check was run in parallel with root.

Two later supplemental runs passed: source-route HTTP/cancellation tests **9/0,23 assertions**, and crop/hero/report tests **15/0,89 assertions across5 files**. The full coordinator run exposed that the old source-route fixture lacked a `Request`; the fixture now supplies a real request/signal and explicitly protects canceled SSR reads from being relabeled503. Production signal propagation was retained. Summaries and exact commands: [implementation-playback-supplemental.json](evidence/implementation-playback-supplemental.json).

New behavior coverage:

- The real `openReading` serializer receives a linked candidate containing name, display format and an additional future display object. Its output passes the actual strict server schema and installs the returned provider format. The same schema continues rejecting an unknown command field.
- Installed EPUB.js Archive/Resources methods use real Blob URLs and an authored tiny archive. Five cycles release archive image/original CSS/rewritten CSS URLs; another book remains readable. Asset and CSS reads held until after owner destruction allocate URLs that are immediately revoked. A real installed `Book.open` with a complete minimal package proves the per-book hook installs before automatic replacements. These are deterministic library regressions, not actual-user EPUB latency/RSS measurements.
- Twenty held heartbeat ticks admit one request; presentation cleanup aborts its signal. A late410 cannot close the replacement reader.
- Current music/trailer route and service bodies feed the real Jellyfin adapter and provider queue, with isolated authorization/storage. Aborting five queued paths—browse, detail, artwork permission, trailer list and trailer playback-info—removes the queued task; provider executions, persistence observations and artwork downloads remain0. These are transport failure tests, not live-provider performance measurements.
- Existing real RAR/7z/TAR decoder tests verify natural order, backwards/repeated seeks and invalid archive rejection after the descriptor-map change. Existing comic/PDF cancellation and EPUB output-budget tests remain green.
- Actual compiled Svelte hero lifecycle and PersistentPlayer's current analysis effect run with the real crop sampler against an isolated native/timer boundary. Hidden/paused/background hero and eight disabled player states leave0 pending sample timers; stale canceled sample callbacks cannot reschedule. Source URL/write count, media position and reload count stay unchanged across suspend/resume. This is deterministic lifecycle coverage, not measured browser CPU/RSS savings.

Root then verified LIVE-02 after this command fix in normal signed-in development: automatic saved-linked Read opened the actual CBR without the schema error; a1988×3057 image decoded, navigation advanced page2→3 of23, minimizing removed attached images, Resume restored page3, and intentional Close left0 images and no Resume button. This is the new after-change acceptance, distinct from LIVE-03's earlier warm baseline. Exact command keys are protected by the contract test; browser payload bytes were not captured. No actual private EPUB was supplied; multi-cycle browser URL/worker/RSS plateaus remain open. The later crop-analysis change still awaits root's coordinated live acceptance.

## Remaining boundaries and next work

- PR-04 is partial: server-artwork shared-flight consumer ownership (PJ-01), shared metadata consumers and matching-reading per-consumer cancellation still require their own shared owner repair. This patch does not pretend that forwarding a first request's signal fixes every shared flight. Uncancelable SQL already admitted before a signal check is not newly made cancelable.
- PR-07's native reverse-storage traversal remains. The metadata map removes the avoidable JS scan; it does not claim to remove the demonstrated quadratic native revisits. A byte-bounded cache/access redesign needs actual-file measurements and memory budgets.
- PR-10's current snapshot sizes are modest; projection correctness is clear, but actual relay byte/latency savings were not remeasured here. Do not promote the baseline's small P3 opportunity to a large measured gain.
- PR-12 retains one warm hidden hero source/buffer by the existing policy. Analysis timers/canvases now stop, but full source unload would change resume/network behavior and is not claimed implemented.
- PR-02's stop/report and persistence recovery, PR-05's per-item persistence transactions, PR-06's eager EPUB processing, PR-08's party heartbeat SQL, PR-09's permission/range floor, PR-11's large sequence semantics, PR-13's pre-decode limits and PR-14's retention policy remain outside these changes. Existing audit options/approval boundaries continue to apply.
- Broader root checks and stable actual catalogue/file journeys must verify these changes together with concurrent SQL, detail, search and panel work. Preserve personal/party handover, policy withdrawal, bookmarks, reader minimize/resume, strict input checks and complete cleanup. Stable cold/warm and production/development evidence must remain labeled.
