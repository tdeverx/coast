# Shared UI implementation — 2026-10-15

Implemented UI-01, UI-02, UI-03, DISCOVERY-02 and STRUCT-02 in the current working tree. Existing unrelated pending changes were preserved. No discretionary visual/style changes, dependencies, commits, pushes or database operations.

## Changes

- **UI-01:** Ordinary Button menu items dismiss by default. Compact submenu Back, multi-list membership and PartyMenu controller multiselect explicitly retain the menu; playlist commands dismiss. RecommendAction deliberately retains its owner through the dialog, isolates picker menu context, and closes the original menu with focus restoration on dialog close. Menu action, keyboard and focus scans treat dialogs as boundaries. Real rendered checks caught and corrected both recipient-picker owner removal and compact Back closing the parent.
- **UI-02:** Header preview presence/status uses local state, playback uses injected context, and preview hides the global reader resume control. Preview logout cannot submit a native form. Demo captures native submissions and uses local Heading medium selection. MediaCard preview primary activation and shallow-modal selection cannot escape into production navigation; already-prevented navigation remains prevented.
- **UI-03:** Design documentation matches existing narrow icon navigation and the four material/fallback pairs; retained menu controls are explicit.
- **DISCOVERY-02:** Discover cache resets for viewer/content revisions, section, feature availability, selection and fresh SSR payloads. Explicit load fetches afresh; unchanged medium switches keep bounded cache. Withdrawal cancels obsolete work, resets invalid medium/read kind and rejects late delivery. Never-activated rows remain lazy.
- **STRUCT-02:** The pure reader cancellation helper is owned by `reading/reader/load.ts`. PDF/EPUB adapters no longer runtime-import the engine; type-only contracts remain. No compatibility reexport was added.

## Verification

Final focused test command:

```sh
PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/ui-discovery-source.test.ts tests/reading-reader.test.ts tests/ui-client.test.ts tests/ui-design-system.test.ts
```

**12 pass, 0 fail, 126 assertions across four files.** New tests compile the actual Discover rune module and exercise revision invalidation, explicit reload, fresh SSR source data, disabled listen/play/read cancellation, stale-result rejection and lazy activation. Reader tests exercise cancellation, already-closed loading, decoder failures and listener removal. Existing injected-client tests cover preview rejection and route refresh scope.

The installed Svelte compiler compiled Button, Header, MediaCard, RecommendAction, PartyMenu and ui-preview/Demo individually with **zero warnings**. No shared check/build was run by this subagent.

The preferred CUA browser was unavailable: `createBrowserTab("iab", …)` returned “Browser unavailable” and `listBrowsers()` returned `[]`. Following the frontend testing skill and parent authorization, verification used the installed cached Playwright CLI and existing Chromium headless shell; no downloads or dependency changes.

A disposable fixture served actual Button/Header/MediaCard/RecommendAction components with synthetic injected API, playback, status and navigation contexts on loopback port 49591. Other action panels were stubbed. No database/provider was accessed. Rendered checks passed:

- Desktop pointer and keyboard ordinary commands dismiss and restore root focus; nested retained checkboxes remain open and nested ordinary commands dismiss the hierarchy.
- At 390×844, retained selection, compact Back, ordinary dismissal and root focus work.
- Recommendation recipient selection preserves the dialog; synthetic Send and Cancel close the dialog/menu and restore root focus.
- Local preview Away and Share activity changes leave global state and setter counters unchanged.
- Preview Sign out keeps the fixture URL and sends no logout request. MediaCard Play/caption selection leaves URL and navigation counter unchanged.
- Final console: **0 errors, 0 warnings**. Server observed **0 unexpected live requests**.

Screenshots were captured and inspected at `/private/tmp/coast-ui-fix-fixture/desktop.png` (1440×1000) and `mobile.png` (390×844). Browser and temporary server are stopped.

## Dialog audit and limits

MediaActions confirmation, sequence, metadata/playback-error dialogs and PresentationActions playback-error dialog have stable owners outside their menu children. RecommendAction was the owned lazy-menu dialog that required retention and context separation.

This is real rendered verification of bounded synthetic workflows, not production/provider verification. The fixture served source CSS without Tailwind/font compilation; screenshots establish rendered behavior, not complete visual certification. PartyMenu controller multiselect and Demo form/Heading guards were compiled and statically reviewed, not individually exercised as complete rendered workflows. Shared check/build, full database tests, live/dev database and providers remain outside this subagent's verification scope.
