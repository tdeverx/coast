# PR review corrections: playback eligibility and container bootstrap

17 November 2026. Automated review of PR #79 found a valid regression in published commit `1ef98ad`: `CatalogueActions` required truthy `available` for album/track playback, although valid source-aware list DTOs can omit that optional field. Such items kept their durable work or connected source identity but lost their Play action.

The correction reuses the existing `canPlayMusicCard` predicate in the shared catalogue menu. Album/track items with a usable work/connection identity remain eligible when availability is unspecified; explicit `available: false` still disables them. Artists continue to require a canonical work and affirmative availability. The existing playback feature gate and server source authorization remain authoritative. No provider access is inferred from metadata or from an arbitrary work UUID.

This is a constant-time presentation eligibility correction. It adds no requests, cache, scheduler, dependencies or persistence, and preserves command cancellation/acknowledgement lifetimes. Materials, menu layout and server playback admission are unchanged.

The original PR's container CI subsequently exposed a separate real bootstrap failure before migrations: `db/schema.ts` imported the reading bookmark-cycle sentinel at runtime from `reading/model`, but the standalone container migration copy ships the database source directory only. The repair keeps reading model imports type-only and represents the persisted initial-cycle UUID directly in the schema, matching migration 0074 and its snapshot. It does not expand the container's application-source copy or alter the stored value. The new regression reproduces the shipped schema/jsonb-only layout in a temporary directory, imports it in a fresh process without the reading model, and checks both defaults against the domain constant. The old missing-module failure was reproduced before the repair. The focused container selection passed **10 tests / 32 assertions**; renewed container CI remains pending.

The focused playback regression selection passed **18 tests / 123 assertions**, including seven actual parent-rune playback cases and zero menu action-state reads during direct dispatch. The standalone probe has a five-second child-process deadline/kill and a ten-second test deadline; its focused case passed **1 test / 3 assertions**, and its timeout options passed a separate strict TypeScript check.

Final local gates for the frozen correction source passed:

| Gate | Result |
| --- | --- |
| Complete unit selection | **1,162 passed, 833 guarded skips, 0 failed; 37,716 assertions across 347 files** |
| Type/Svelte check | **0 errors, 0 warnings**; new subprocess timeout options also passed strict single-file TypeScript checking |
| Production build | Passed |
| Source/style/inventories | **57 adopted style modules; 644 production modules, 0 unused; UI 65/29/19/9**; whitespace clean |

Logs are `/tmp/coast-menu-pr79-corrections-units.log`, `/tmp/coast-menu-pr79-corrections-check.log` and `/tmp/coast-menu-pr79-corrections-build.log`. Native SQL and stored default values are unchanged, so the local full database run was not repeated for this correction. The initial PR's pinned database CI had passed **770 tests**; renewed CI must rerun against the correction commit. The original container failure above remains a real failed result; local standalone acceptance does not relabel it. Renewed hosted verification, database and container CI remain pending. No new provider/throughput/device claim is made.

The new playback-eligibility receipt advances exact predecessor hashes through the existing receipt chain. The published `source-refresh.md/json` and `followup.md`/`followup-source-refresh.json` remain unchanged, including their historical measurements, review findings and remaining acceptance boundaries.
