# PR-09: reuse one verified context per reading request

The shared reading-file owner now resolves Jellyfin once within each operation and uses that exact generation-checked context for its metadata and byte request. The public `ownedReadingSession` function still returns the session row alone, preserving progress, heartbeat and party callers. No context is retained across requests or exposed to clients. [Machine-readable evidence](implementation-reading-context.json) records the exact scope and source pins. Current-source normal-dev actual CBR functional acceptance passed; remaining formats/Range/HEAD and measured resource work remain open.

## Shared change and correctness boundaries

In [sessions.server.ts](../../../src/lib/reading/sessions.server.ts#L87), a private `readingSessionContext` retains the owned/open/unexpired session and identity-conflict predicate, enabled-user/work/feature checks, connected enabled Jellyfin source and saved account-generation comparison. `ownedReadingSession` projects its original row result; `streamReading` consumes the operation-local context directly. Previously, `ownedReadingSession` resolved/decrypted Jellyfin and the stream immediately repeated that work. No provider I/O or publication occurred between those two resolutions, and the second context was not itself compared with the saved generation.

Every separate GET, HEAD, Range, bookmark, heartbeat or party-owned-session operation still starts a fresh check. The stream retains its user-specific provider metadata GET, exact item identity, format/full source fingerprint, request signal, one-range validation,20s provider timeout,512MiB streaming cap, safe header allowlist, body cancellation and private no-store response. The browser-cookie authentication path is unchanged. Required metadata and byte requests are not eliminated.

Preparation and file observation retain their policy/account/source-generation transaction fences. Bookmark/progress transactions and party create/join/command publication checks are unchanged; they do not receive this source context. Local files still remain in the browser, and the public row contract does not grow a `jellyfin` property.

The stream has no new database lock or final generation re-read after provider I/O. This change does not promise to stop every already in-flight response after a later local revocation. It removes consecutive pre-provider resolution work; it does not introduce an access cache, immutable capability or a broader revocation policy.

## Actual-data census

The [actual-clone census](evidence/implementation-reading-context-census.json) ran in a reserved repeatable-read READ ONLY transaction with verified10s statement/1s lock timeouts, then rolled back and closed its pool. No domain/notification function, provider call, credential/key decryption, normal database mutation or fixture creation ran.

| Existing cohort | Result |
| --- | ---: |
| Reading works |12 comics |
| Linked editions |6 CBR +6 CBZ, on1 instance |
| Saved sessions |4 CBR sessions for1 owner |
| Active / closed sessions at capture |3 /1 |
| Matching current generation, connected/enabled source facts |4 of4 |
| Linked edition-owner bindings |24 CBR +24 CBZ, across4 owners |
| Reading-progress rows |1, with total23 pages |

These persisted facts establish real session/source cohorts. They do not establish present provider permission, decrypted credential validity, source metadata responses, Range/HEAD bytes or request timing. No actual PDF/EPUB session cohort appears here.

Existing [normal-dev browser evidence](evidence/normal-dev-live.json) and the earlier [playback implementation receipt](implementation-playback.md) accepted one actual saved-linked CBR: a1988×3057 image, page2→3 of23, minimize, Resume and intentional Close. Its private title/UUID were intentionally omitted from maintained reports. The visible acceptance path is Library → View all Read → an actual issue → Read. That earlier success is not an after-change pass for this new source.

## Supplementary exact-owner verification

The new isolated [context fixture](../../../tests/fixtures/reading-request-context.ts) executes the real session module, `getJellyfin`, `connectionFor`, `getInstance` and Jellyfin item adapter. Database/policy/crypto/provider boundaries use controlled values; no fixture setup runs on the actual clone. The [captured-before/current comparison](evidence/implementation-reading-context-ownership.json) passes19 schedules each, including GET/HEAD/header/body handling, row-only owned returns, local-file behavior, ended/unowned session, disabled account/source/instance, missing work, withdrawn reader, a changed generation on a separate request, denied metadata, changed fingerprint, wrong item, invalid multi-range,416/500 cancellation and already-aborted delivery.

| Successful controlled GET/HEAD | Before | Current |
| --- | ---: | ---: |
| Counted session/user/work/connection/instance SELECTs |7 |5 |
| Connection SELECTs |2 |1 |
| Instance SELECTs |2 |1 |
| Credential decryptions |3 |2 |
| Feature / metadata / byte-request calls |1 each |1 each |

Policy SQL and configuration queries are controlled here:7→5 is not the entire real request SQL total. These counts prove the removed local ownership work, not actual latency, resource usage, wire savings or fewer provider requests. Full projections and the remaining Download-header decrypt remain.

The context and existing request-cancellation suites pass2 tests/0 failures with6 outer assertions; the context child independently asserts its19 schedules. Queued/active/already-aborted permission lookup and identity controls continue to pass. The initial missing mock export and private baseline alias invocation were probe setup corrections; the final runs use an explicit project tsconfig and a relocated model import only. The [saved baseline](candidates/reading-context/sessions.before.ts.txt) includes earlier authorized changes and is compared directly, rather than treating the older Git version as the immediate baseline. The [portable comparison probe](probes/reading-context-ownership.py) checks source fingerprints before loading either version.

Independent read-only review found no material issue at the exact application source pin. Root common gates pass777tests/0failures with703guardedskips, check0/0 and build/inventories. The [source-frozen normal5173 trial](evidence/implementation-context-material-normal.json) opened the actual linked CBR, decoded a1988×3057image, turned3→4→3 of23, minimized with Show UI, resumed page3 and intentionally closed. Final comic images, Blob images and a visible Resume action were absent. Normal reading progress/time can be saved by these commands; normal data is not claimed untouched. Source hashes were unchanged and no new console warning/error appeared. This is functional real-provider/file acceptance, not a measured SQL/decrypt count or exact Range/HEAD/byte trace. Full actual PDF/EPUB/CBZ Range/HEAD byte/status/header traces and reconnect/revocation/file-change interleavings remain explicit gaps. No generic all-format completion or measured speedup is claimed.

## PJ-13: read-only follow-up

The current100-entry/15-minute complete-insights cache in `catalogue/details.server.ts` is keyed by review page. Each uncached TMDB page calls `tmdbInsights`, which refetches base details/credits before its page-specific reviews. Child season/episode paths have no review request; Trakt has its own existing path through the same bounded cache.

The smallest coherent option splits invariant facts/crew from review pages at the TMDB owner and composes the same DTO through an explicitly bounded cache contract. Candidate files are `providers/tmdb/details.server.ts`, its adapter and `catalogue/details.server.ts`. A second independent100-entry cache silently expands the present aggregate budget. Reusing base data also changes refresh timing across pages and incomplete-review retries; preserve full fields, language/region/source keys, no-review children and untouched Trakt behavior under a reviewed freshness/eviction contract.

No actual consecutive review-page/provider response trace is retained. Saved catalogue metadata cannot verify full review wire content or a natural page gain. Capture that trace and compare full DTO, incomplete/error/TTL/eviction/concurrent behavior and provider counts before adoption. This task made no PJ-13 implementation or status change.
