# Shared menu scope reuse and hero capability withdrawal

Applied at existing shared owners. Five menu families now reuse the scope their effect has just synchronously computed; all fresh read/response/mutation admission checks remain. The root hero video now releases its source when screen or playback capability is explicitly withdrawn. HELPER-01/UIC-01 and PR-12 advance but remain partial; the same menu gain is counted once. Known work remains unfinished, with unchecked areas on the separate roadmap.

## Menu work and correctness

Previously each tracked effect computed `workMenuScope`, then immediately called `sync()` which computed the same scope again. `sync(next = key())` permits passing that same synchronous value. Existing callers without a tracked value retain their current behavior. Work controls, ScreenActions, CatalogueActions, WorkListActions and PartyMenu pass the key they already track. There is no await between capture and use. No key fields, invalidation dependencies, DTOs, permissions, caches, warm snapshots or component mount policy change.

The [actual-input receipt](evidence/implementation-found-09-menu-actual.json) preserves **52 before/candidate callback outcomes** using all four enabled actual owners, their settings/configuration/revisions, actual canonical screen/music/game/comic identities and complete actual `workActionData` DTOs. Exact TypeScript-AST-derived callback bodies execute against installed-compiler shared resources under controlled closed/open/session schedules. Closed scope calls fall **2→1**; open effect calls fall by one. Complete DTOs, domain-read counts, reset counts and warm reopen behavior match. The read-only repeatable-read private-clone transaction rolls back and closes, with no provider fetches or inserted cohorts.

This is actual input and complete shared-resource payload equivalence, with controlled scheduling. It does not certify full five-family HTTP/UI payload schemas, natural rendered dependency tracking, positive saved lists or active parties. Party uses its valid absent-room key; no fake list/party/history/catalogue record was created. The receipt's `currentSourcePins` is the pre-adoption epoch; `candidateSourcePins` matches adopted source. One fewer key evaluation is not a measured CPU, heap or latency gain. The added stale-captured-scope regression verifies fresh `open()` rejects an outdated scope and reads the replacement; authored control strings are supplementary.

## Hero capability lifecycle

The root hero can outlive route components. Its source effect previously depended only on retained URL/ID, so a stale claim could retain a decoder after feature withdrawal. Current screen/playback capabilities now gate source and visibility. Existing cleanup pauses, removes `src`, calls `load()` and disposes crop analysis; primitive hero identity/URL remains for a later allowed attachment. This enforces the existing feature-Off rule and introduces no dependency, policy setting, schema or visual change.

Two compiled-owner capability controls verify screen-Off and playback-Off each hide the owner, detach source, pause the element, end timers and call `load()` once; reenable attaches again. The fake boundary video/timers are explicitly supplementary controls, not actual media bytes/codec/RSS evidence. Existing eight persistent-player disabled cases and warm hidden/paused hero behavior remain. Ordinary no-consumer source retention is unchanged; it is not silently converted to an unload policy.

## Normal signed-in acceptance

The [native receipt](evidence/implementation-found-09-normal.json) uses the user's normal authenticated `localhost:5173` tab. Actual **The Avengers** detail opens, its Actions menu closes and reopens, and all root command text remains. Raw full text differs because existing pointer hover opens Jump to and adds its actual child; this is recorded rather than called exact whole-menu equality. One premature Return encountered a transitioning title link and timed out; the completed actual detail/menu state is verified. No domain/menu command or foreground playback was submitted.

Actual **House of Gucci** hero trailer loads at 1920×1080/readyState4, pauses at scroll1440 while retaining its allowed source, resumes at scroll0, pauses on Search without a hero consumer and resumes on For You. Main video/audio sources stay empty and paused. Final UI is nonblank with no Vite overlay, no dialogs, no visible menus and no new warnings/errors. Retained hidden menu elements are not counted as open popovers. This is functional current-source acceptance; it is not direct sampler timing instrumentation, a resource benchmark or natural feature-Off acceptance. No feature setting was toggled.

Native CUA browser control and Playwright locators were used because the dedicated Browser plugin is absent; no browser/dependency was installed. This pass changes no layout, so acceptance covers the existing desktop viewport, not a new responsive-design claim.

[Actual movie menu (private verification image)](publication.md#private-verification-images)

[Actual root hero after return (private verification image)](publication.md#private-verification-images)

## Verification and drift

Final [gates](evidence/implementation-found-09-gates.json): **840 passed,715 guarded skips,0 failures,34,224 assertions**; Svelte/type0 errors/0 warnings, production build/navigation drift, source/UI inventory and style pass. Focused menu checks:15 passes/65 assertions. Compiled video lifecycle:1 test/2 wrapper assertions, with detailed child boundary checks. Skips and authored fixtures do not replace actual acceptance.

The [manifest](evidence/implementation-found-09-source.json), exact [seven-owner patch](candidates/found-implementation-09/runtime-owner-changes.patch), before/after snapshots and [maintained actual probe](probes/menu-scope-reuse-real.ts) preserve source epochs without overwriting unrelated working-tree changes. [performance.md](../../performance.md#reuse-a-synchronously-tracked-menu-scope-without-weakening-admission) records the synchronous-only contract and fresh admission fences. Future async capture must not reuse the tracked key. Keep original actual receipts immutable and rerun applicable probes after semantic changes.

HELPER-01/UIC-01 still lack a reviewed minimal policy-key architecture and positive list/party/native scale coverage. PR-12 still lacks natural feature withdrawal and sustained codec/heap/CPU acceptance; ordinary warm-source policy is retained. UIS-04 activation latching is unchanged. Current canonical counts stay24 open/36 partial, with other applied statuses and acceptance gaps visible. Tasks keeps the user's selected pair. No commit, push, deployment or new-area audit is performed.
