# Shared control lifetime implementation and notification policy options

Implementation supplement, 2026-10-17. Baseline audit commit: `eb0673873462b71118d1c11678d128958a05ff07`. This records later work without changing the original findings. No commit, dependency, visual design or normal/deployed database mutation was made by this work.

## HELPER-02: closed menus release breakpoint listeners

Implemented in the canonical `createMenuController` owner in `src/lib/ui/controls/menu.svelte.ts`. `Button.svelte` is its consumer, so ordinary, nested, work, queue, profile and other menus using Button share the change. The breakpoint `change` listener now belongs to the same open interval as the ResizeObserver, placement listeners and outside interaction watcher. Closing, navigation and disposal release that listener. An open menu still reacts immediately to compact/desktop changes and updates its parent's drill-down presentation.

A closed controller retains its MediaQueryList object but has no breakpoint subscription. Its `compact` getter reads the live query; `openMenu` also refreshes the mode before informing its parent. Both are necessary because Button's nested mouse-hover admission checks `compact` before it calls `openMenu`. Refreshing only at open would leave a menu unable to open on first desktop hover after a resize while closed. Existing markup, focus, placement and compact back controls are preserved.

Focused verification: **12 passing tests, 37 assertions, two files**, Bun 1.4.3. `tests/menu-lifecycle.test.ts` runs two actual nested controllers compiled by Svelte with isolated DOM/media-query boundaries. It checks zero closed-menu breakpoint listeners, observers and global watchers; two open nested listeners; fresh mode before first hover/open; compact parent hiding; child focus restoration; resize while open; Escape; parent close; native toggle; navigation and terminal disposal. Existing `ui-menu-resource` tests also pass. This is a behavioral resource-ownership regression, not a browser CPU/heap measurement or a fabricated performance workload. Raw output: [implementation-menu-focused-tests.txt](evidence/implementation-menu-focused-tests.txt). Real-browser responsive menu acceptance remains with the parent audit run.

## UIS-01: durable policy selected; candidate remains staged

The user selected suppression that survives windows and reloads. The exact reviewed implementation is isolated in `/private/tmp`; normal application source and database schema remain unchanged. The [maintained toast report](implementation-toast.md) and [machine-readable receipt](implementation-toast.json) now own its policy, shared owners, tests, actual-data proof and rollout limits. The original audit finding remains unchanged.

The candidate retains suppression in one nullable notification-row timestamp, keeps inbox read/dismiss state independent, bounds client state and write admission, and coalesces optional refresh independently. It has not been adopted into normal-dev. Both private-clone and actual normal-dev read-only preflights fail closed for 0039 hash drift and both 0062/0063 pending. Rollout is blocked until provenance and exact migration scope are resolved.

The [actual DTO census](evidence/implementation-notification-census.json) remains four windows of 2/2/12/3:12old normal(7unread) and7old read silent notices. There are no actual recent normal or persistent cases. Those behavior cases use authored regressions; no memory/CPU/latency improvement or actual persistent acceptance is claimed.

## HELPER-05 — queue feedback stays in its client scope

`createQueueActions` now uses `useClient().feedback` captured at construction, matching other scoped controls. Success text, per-entry concurrency and retry semantics are unchanged. A pending real-client completion cannot publish to a subsequently opened preview client, and preview success cannot reach the application notification owner.

The focused controlled suite passes three tests / 19 assertions, including distinct concurrent client scopes and failure silence. These are supplementary correctness checks. Actual signed-in Tasks loading/filter/navigation checks remain in the live receipt; no real job was retried, cancelled or promoted to manufacture acceptance data. Actual action delivery remains unverified.
