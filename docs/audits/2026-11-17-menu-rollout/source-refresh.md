# Shared menu rollout: source review and verification limits

17 November 2026. This is a new local source epoch for the shared menu rollout, its filter integration and the accompanying Progress corrections. The dated hosted, completion, independent-continuation and selected-policy reports retain their original observations. This report does not replace their remaining acceptance or establish production latency, throughput or memory bounds.

## Shared owners and demand

`Button` and `controls/menu.svelte.ts` continue to own row rendering, native popovers, focus, placement, touch drill-down and dismissal. The approved groups use the existing geometry/material tokens rather than feature-specific menu skins. Mouse flyouts use one cancelable leave deadline, cleared on return, close and disposal; keyboard-opened children retain keyboard ownership. Existing shared outside-interaction and placement owners remain in use. The permanently visible specimen mode is preview-only and does not attach production positioning observers.

Screen and catalogue action compositions render through `WorkMenu`. They keep domain mutations in their existing commands and only read action state after demand. `createMenuResource` single-flights an unfinished read, retains a complete unchanged snapshot across reopen, fences publication by work/viewer/occurrence/revision, aborts close/replacement, and does not refresh a closed menu. An acknowledged field patch does not turn an incomplete response into a complete snapshot. `retryMenuRead` allows one transient retry with a cancelable 250ms delay while the owning menu remains current; authorization and rate-limit failures are not automatically repeated. Mutations use their own existing retention and are not retried by that helper.

Lists load their first existing server page only when opened and append additional pages when the sentinel is visible. There is no new list-count truncation. Retained choices grow with the viewer's browsed list pages for that mounted work, and are released with that owner; this is not a fixed-size cache or a proven browser memory plateau. Inline creation uses the existing list command and duplicate-submission guard. Entry reorder/remove retains occurrence identity; title actions are a lazy child of the entry menu.

## Query and domain review

The current check-in identity is projected in the existing on-open action read. Its indexed active-per-user scope yields at most one active check-in; screen-group matching probes the current leaf's parent rather than hydrating all descendants. Show/season episode choices and artist track choices load labels in pages of 20 plus one lookahead. Artist membership and playable-source checks share the same local SQL owner for playback and check-in, retaining user, connection and enabled-instance constraints. Artist playback rejects an expansion beyond the existing 10,000-track queue limit rather than silently dropping tracks.

Cross-medium manual check-ins use the existing server transaction, per-user admission and expiry maintenance. They do not introduce an interval for each menu/card, fabricate a media runtime or mark a manual check-in completed merely because it expires. Reading rereads preserve prior progress/bookmarks behind a cycle identity; stale End actions cannot restore another cycle. The existing transient cleanup keeps the newest bookmark in the current and restorable cycle and retains its 500-row maintenance batch. Game completion retains the selected playthrough and chosen event date. These contracts have local regression coverage; no hosted provider or physical-device acceptance is inferred.

Progress's empty-tab summary uses fixed existence probes and request-local planning shared with the selected screen page. It does not hydrate a page for every tab. The source requests a summary once for its owner/content epoch, preserves it while changing filters/pages, and rejects old viewer responses. Empty confirmed segments and rows can hide without using the currently filtered page as proof that the underlying segment is empty. Reusing planning reduces duplicate logical preparation in this request, but this review does not assert a measured production speedup. Episode/sequence planning still scales with the owner's existing tracked candidate set; the change does not make that historical work constant-time.

Applicable row controls use one shared filter menu across local shelves, Library/Collection, recommendations, Discover, Progress, lists, search and credits. Navigation segments remain navigation. Local finite filters perform no extra reads; remote filters keep the original page owners, cancellation and linked selection URLs. Fixed library-only recipes do not expose an ineffective availability switch. Public recipes and music do not gain unsupported screen/library filters. Screen Paused is selectable in Library and personal Collection and excluded from Library In progress using existing tracking records. No source/page bounds or returned choice sets were reduced to improve timing.

## Verification at this epoch

The focused independent review used host Bun `1.4.4-canary.1+963452075`; database checks used disposable local PostgreSQL databases, not the live database:

- Source/control/navigation suites: **53 passed, 370 assertions** over seven suites, covering activation, retained filters/URLs, superseded and canceled delivery, permission/owner replacement and local-filter read counts.
- Menu-resource, request-option, medium-date and reference suites: **29 passed, 113 assertions** over four suites. These include single-flight/reopen, close/scope changes during retry, pending-snapshot patching and exact chosen work/playthrough identities.
- Menu lifetime and work-scope suites: **4 passed, 26 assertions**. Closed renderers retain no breakpoint listeners, and changed role/occurrence scope fences old delivery.
- Library database suite: **4 passed, 22 assertions**, including accessible paused screen membership in Library/Collection and exclusion from In progress.
- UI inventory generation/check: **65 public components, 29 explicit compositions, 17 internal renderers, 9 delegated routes**. `CheckInActions` is internal to `WorkMenu`, with no duplicate public specimen. Adopted style check covered **57 modules**; code inventory and whitespace checks passed.

The root rollout's full test/type/build results and any interactive preview evidence must be reported separately from these focused observations. A preview transport validates rendering/interaction in synthetic state; it does not establish native provider, authentication or production-route behavior. Database fixtures establish the exercised state transitions and query membership, not real-catalogue plans or tail latency.

The root independently reported **29 passes / 129 assertions** for its current menu-resource/reference/request-dialog-lifetime/medium-completion selection and **4 passes / 111 assertions** for the isolated artist database suite after its typed-query correction. Those are different selections from the independent groups above and must not be added as unique-test totals.

Root's consolidated typecheck completed with **0 errors and 0 warnings**, in a single process with a 2 GiB JavaScript heap cap. The preview owner checked the direct Episode menu: its four quick controls share an equal 218 × 40 group with the stars, the Ready switch hides its row, the URL switch disables Copy with a reason, and Revoke opens a cancellable confirmation dialog. These are synthetic preview checks, not a signed-in actual-provider journey.

Root's production build also completed successfully under the same heap cap; existing oversized-chunk and `NO_COLOR` warnings remained. Its source-style, code inventory (**640 production modules, zero unused**), UI inventory and whitespace gates passed.

## Feature parity still open

| Scope | Implemented boundary | Remaining preview parity |
| --- | --- | --- |
| Artist | Source-authorized Play, Shuffle, paged track Check in and provider Favourite | Artist rating, reaction, list membership, profile background, track-listen logging and history remain planned. Artists retain provider identity rather than a fabricated canonical track/work. |
| Reading history | View history; dated completion and reread lifecycle through the existing reading commands | Mark unread and Reset reading position remain planned. No destructive/reset behavior is inferred from the view-only history menu. |
| Requests | Season checklist, standard/4K variants and existing request management | Individual episode request submission remains intentionally disabled. |
| Personal artwork | Existing stored private presentation still applies; shared metadata tools remain admin-owned | Personal artwork picker/editing stays deferred and hidden from the current menu. |

These gaps prevent a claim of complete cross-medium feature parity. Preview-only planned actions must keep their purple/unapproved treatment until the corresponding domain contract is implemented and verified.

## Remaining acceptance and receipt policy

Normal signed-in desktop, keyboard and touch journeys across actual providers, sustained open/replace/close resource measurements, large-catalogue query plans, and real-file/party/device acceptance remain outside this local source refresh. Earlier explicit blockers and rejected optimizations remain unchanged. No performance finding is closed solely by repinning a file.

The adjacent receipt walks exact predecessor hashes from the existing verification, completion, independent, selected-policy, hosted-companion and subsequent November refresh chain. Supporting rollout files without an earlier audit pin have separately checked current hashes. This binds the reviewed code and report without rewriting historical receipts or reclassifying their actual-data results.
