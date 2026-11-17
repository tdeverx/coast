# Filter and source integration audit

The menu rollout keeps navigation segments at the row heading and sends applicable filters to the shared `RowFilter`. Availability and Collection are binary checkbox rows; their existing owners still supply both choices. Other groups use `ChoiceGroup`, without a second loader or renderer. No source page-size or source-count limit is reduced by this change.

The source review covered local finite shelves, Library and personal Collection, Discover, recommendations, Progress, saved/profile rows, lists, search and credits. Request status and credit department choices join the filter menu; entity, recommendation-recipe and playback/progress navigation retain their own segments. Sources expose only supported filters: public recommendations do not claim library-only availability, library-only recipes do not expose an ineffective availability switch, and music does not acquire screen watch-status values.

Library screen status now includes Paused. Its existing status predicate excludes paused titles from In progress, while personal Collection recognises paused screen state alongside reading and games. Both reuse the viewer-scoped tracking records already joined or indexed by user and work. These changes add no per-card read, provider request, timer or cache. The Collection predicate is a correlated existence check on the existing tracking identity; a full production-dataset plan comparison has not been recorded here.

Verification on 17 November 2026 used the local Bun `1.4.4-canary.1+963452075` tool and disposable PostgreSQL test databases:

- Seven source/control suites: **53 passed, 370 assertions**. They cover lazy activation, obsolete and cancelled delivery, viewer/permission changes, local filtering without additional reads, linked destinations retaining selections, native music pages and Library/Collection status ownership.
- `action-library-db.test.ts`: **4 passed, 22 assertions**, including a paused accessible movie in Library and personal Collection, excluded from In progress.
- UI inventory generation/check: **65 public components, 29 explicit compositions, 17 internal renderers, 9 delegated routes**. `CheckInActions` is represented through `WorkMenu` rather than a duplicate public preview.
- Adopted source-style check: **57 modules passed**. Code inventory and `git diff --check` passed.

These are functional, demand and cancellation regressions, not measured live latency improvements. Normal signed-in desktop/touch journeys, large-catalogue query plans and browser resource plateaus still require the broader rollout acceptance. Existing dated source/hash receipts remain historical evidence at their recorded source epoch.
