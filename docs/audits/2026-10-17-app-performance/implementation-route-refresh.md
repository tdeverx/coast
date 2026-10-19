# Shared route refresh caller contract

`ROUTE-REFRESH-OBS-07` is an additional observation outside the original 94 records. Nine direct in-place invalidation calls across six files now use the existing `refreshRouteDependencies` owner. An already-open shallow overlay gets its existing state-preserving refresh; ordinary scoped refreshes retain the same dependencies, and full Music/Games Retry retains full invalidation. Source, focused tests, common gates and the normal signed-in visible-window trial pass. Mid-flight open/close ownership remains unresolved.

## Actual incident and matching installed mechanism

The [frozen-source signed-in normal-dev receipt](evidence/implementation-shared-normal-before-poll-fix.json) records a settled Friends panel on Tasks at `00:54:29.533Z`: three friend actions and one close control. At `00:54:51.630Z`, both counts were zero, while the address still contained `?friends=true`. No import error, new warning/error or framework overlay was recorded. An earlier open attempt on that route also left the query open with no panel; navigating to For You allowed Friends to open. This is an actual before/after observation over about 22 seconds, not instrumentation proving two completed polls or identifying the exact committing invalidation.

Source inspection and controlled execution of the installed Kit functions establish a matching mechanism. `JobsSettings.svelte:91` previously called direct `invalidate('coast:settings')` every ten visible, non-overlapping seconds. Installed Kit `pushState` (`client.js:2532–2538`) changes browser history and `page.state` without assigning `page.url` or `current.url`. A reloaded branch with changed data builds `state:{}` (`:863–875`); direct `_invalidate` uses that result (`:417–475`). The address can retain the shallow query while root `friendsOpen` (`src/routes/+layout.svelte:33`) becomes false. `openFriends` (`ui/panels/friends.svelte.ts:5`) separately sees the window address query and returns, so repeated Header clicks cannot restore the panel in that state.

The existing shared helper already chose Kit `refreshAll()` for an open detail/Friends/Notifications/Streams overlay, preserving its captured shallow state. The direct callers bypassed that contract. This repair routes them through that owner; it does not rewrite Kit or establish the exact callback that committed in the observed trial. The normal root presence heartbeat passes `refreshFriends:()=>false`, so its optional direct social refresh was dormant in that path; explicit status/presence changes could still reach direct invalidation.

## Canonical owner and complete caller changes

`src/lib/ui/client.ts:109–114` accepts the existing dependency array or the narrow explicit `'all'` selector. Empty dependencies still do nothing. With no open overlay, arrays still call the same `coast:` invalidations and `'all'` calls `invalidateAll()`. With an already-open overlay, both use the existing `refreshAll()` branch. The app now has no direct `invalidate`/`invalidateAll` call outside that owner.

| Caller | Prior direct calls | Shared admission and preserved lifetime |
| --- | --- | --- |
| Jobs settings poll (`ui/components/JobsSettings.svelte:91`) | 1 | `['settings']`; ten-second interval, visible-only, one pending poll, preview suppression and timer cleanup |
| Explicit status/presence (`social/status.svelte.ts:14`) | 2 | `['session','social']`; acknowledged result, busy/error state and local social revision |
| Interested current heartbeat (`social/status.svelte.ts:33`) | 1 | `['social']`; existing stopped/abort guard, interest predicate and social revision |
| Invitation revoke (`routes/settings/[[section]]/+page.svelte:354`) | 1 | `['settings']`; command acknowledgement precedes refresh; busy/error order retained |
| Current device completion / visible import poll (`routes/onboarding/+page.svelte:26,29`) | 2 | `['onboarding']`; signal/body ownership, provider interval, hidden-import pause and teardown retained |
| Music / Games Retry (`routes/music/+page.svelte:27`, `routes/games/+page.svelte:28`) | 2 | `'all'`; full route/query refresh with the existing interface |

Paths without a `routes/` prefix in the table are relative to `src/lib/`; routes are relative to `src/`. Existing consumers also remain under this owner: acknowledged domain mutations through `refreshAfterChange`, the root session poll and search shelf refresh. The mutation dependency map continues to cover tracking, reading, music/games, lists, planning, social, profile/settings, providers/requests and notification commands. Preview mutation clients keep their isolated no-op refresh transport.

The three `goto(...,{invalidateAll:true})` sites are intentional navigation: list deletion to Lists, password change to Login, and a game-created direct-navigation fallback. They remain unchanged. Kit form enhancement in setup/login/register/onboarding also retains its existing action/redirect behavior; it was not replaced by a background refresh wrapper.

An overlay-open `refreshAll()` reruns all active loaders/queries. That is the existing correctness tradeoff and can do more work than a scoped settings-only refresh. No lower SQL count, faster response or heap saving is claimed for this repair.

## Verification, including the unmodified mid-flight gaps

[Focused receipt](evidence/implementation-route-refresh-tests.txt): **33 passed / 0 failed / 164 assertions** across `route-refresh`, `ui-client`, `presence-lifecycle`, `route-read-lifetimes` and `preview-party-guards`. Five changed components compile with complete client and server templates (**10 compilations**). Source-driven callbacks cover Jobs visibility/nonoverlap/cleanup, explicit status and interested heartbeat dependencies, stopped heartbeat fencing, both onboarding refresh paths, invitation acknowledgement/busy order, full Music/Games Retry, all four shallow overlay keys, ordinary scoped/full behavior and empty demand.

The installed-owner test executes the exact current `_invalidate`, `get_navigation_result_from_branch`, `clone_page`, `pushState`, `replaceState`, `invalidate`, `invalidateAll` and `refreshAll` function source. Only diagnostic route data and root/history I/O are controlled. It reproduces direct state loss plus the repeated-open URL trap, and verifies preservation when the overlay is already open. It is supplementary source-contract evidence, not a DOM, actual-data, natural-concurrency or performance benchmark. No package source was modified.

Two residual schedules are deliberately reproduced and remain **unfixed**:

- A scoped refresh begins with no overlay; an overlay opened while its load is held can still be cleared by the later commit.
- An overlay is open when `refreshAll()` captures state; closing it while the load is held can still be overwritten by that captured open state.

The helper selects its branch at invocation, and installed Kit captures `prev_state` before awaiting `load_route`. This patch does not claim current-at-commit shallow-state ownership. The controlled tests recording those outcomes are boundary evidence, not passing recovery acceptance. The separate staged navigation dependency proposal remains unapplied; no new framework workaround or overlay-state abstraction was added.

Read-only review by `playback_readers_audit` found no material blocker in the scoped source/test diff. Root reported common gates: **766 passed / 703 guarded skips / 0 failed**, 33,338 assertions over 1,469 tests in 263 files; check **0 errors / 0 warnings**, production build, code/UI inventories and adopted source style passed. Root's reviewed current manifest has 576 files / 59,178 lines / 3,711 candidate sites. Guarded skips are not passes. The correction owner ran no broad build, database mutation or provider request.

## Completed normal-development acceptance

Root's [signed-in normal-dev after receipt](evidence/implementation-route-refresh-normal-after.json) began at a cold Tasks URL with no panel query, 30 real task rows and developer automatic jobs paused. Audit-owned repository writes were frozen throughout. Friends retained all three actual friend actions, its close control and open query across **45,893 ms** with the document visible, then closed and reopened with all three actions. Notifications retained its close control and query across **20,322 ms**; Streams retained its close control and query across **21,231 ms**. These latter intervals are calculated from the receipt's before/after timestamps. The trial ended with 30 task rows, zero open popovers, zero new warnings/errors and no framework overlay. The post-trial source manifest check was unchanged.

See the [Friends screenshot (private verification image)](publication.md#private-verification-images) and [final Tasks screenshot (private verification image)](publication.md#private-verification-images). The receipt explicitly says exact completed polls were **not instrumented**: these are elapsed visible-state observations, not a claim that a particular number of polling requests completed. The before/after observations plus installed-owner tests support this scoped caller repair; they do not close the two controlled mid-flight gaps above or the separate navigation exceptions.

No actual status-preference, job-control or other preference write was performed, and invitation revoke/onboarding device authorization remain outside this UI trial. No provider/format/device coverage or resource saving follows from the successful panel observation. Current source/test pins and root receipts are in [implementation-route-refresh.json](implementation-route-refresh.json).

Earlier FRT-04 built-app fault/asset receipts remain pinned to their earlier build. Its component/context/feedback owners are unchanged, but this shared client change produces a newer build; those receipts are not silently relabelled as final-build acceptance. Staged toast's shared client dependency is refreshed separately without adopting its source/schema.

## Maintenance

Keep in-place refresh demand under this shared owner and preserve explicit full versus scoped semantics. Continue using real route actions for navigation and authentication. New callers need focused acknowledgement/lifetime checks plus actual UI acceptance; a fresh direct SDK invalidation must not quietly bypass the overlay contract. Any future solution for the two mid-flight schedules needs its own minimal owner plan and browser acceptance, rather than claiming this caller repair resolves every route race. No commit, dependency, schema change or deployment was made.
