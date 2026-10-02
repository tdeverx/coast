# Audit implementation — 2 October 2026

This implements the immediate AUD-01…18 repair/refactor pass against the original audit baseline. The approved design, routes, UUIDs, histories, authentication bindings and provider/outbox behavior are preserved. No production dependencies, migrations, commits, pushes or deployments were added by this pass. Existing development data and unrelated generated files were not deleted or used as test targets.

## Implemented

- **AUD-01/02/05:** Profile favourite ordering/pins follow favourite privacy; paused Collection filters follow progress privacy before counts/pagination. Collection uses category-aware visibility instead of the API's generic screen gate. Account-wide profile details remain independent of a medium's section settings.
- **AUD-03:** The optional artwork cache has a 1 GiB/10,000-file budget, oldest-used eviction, a 128 MiB free-space floor, serialized admission including temporary allocation, same-image miss deduplication and at most four concurrent downloads. Quota rejection still serves fetched bytes; saturation/disabled caching uses the fixed CDN. One application process owns this cache, matching the deployed architecture.
- **AUD-04:** CI now runs all database suites using PostgreSQL 17. The runner creates and removes a different disposable database/data directory for each suite; it never targets the configured database itself. The stale privacy fixture now separately checks default denial and explicitly authorized sharing.
- **AUD-06:** Admin demand filters/counts users with demand before the 60-user page and performs one batched projection instead of a user-loop of database calls. Opt-outs remain excluded. A 65-empty-user fixture verifies later demand cannot disappear behind an empty page.
- **AUD-07/08/16:** Configuration and source-change orchestration moved to focused application services; provider repositories no longer import Collection workflows. Trakt identity resolution and pure TMDB artwork mapping sit below import/export callers. HTTP dispatch uses domain handlers with a shared transport/auth/error boundary. [Architecture](../architecture.md#ownership-and-naming-conventions) records ownership and terminology.
- **AUD-09/10/14:** Social feed and reactions use the cancellable resource lifecycle, latest-target replacement and teardown. Recommendation/session controls share accepted-friend loading. Shared relationship writes use the injected mutation client. Targeted dependencies replace default page-wide invalidation and redundant mutation refreshes.
- **AUD-11/12/13:** Previews inject local transport/playback state, retain offscreen state, dynamically load the selected components and keep real playback/notification delivery independent. The generated 55-component manifest shows rendered composition and application consumers; CI checks manifest and recipe coverage. Shelf retains one renderer with local/page/cursor capabilities and pure filter mapping.
- **AUD-15:** Friend insights starts from the two users' relationship/activity candidates, retaining the same privacy and meaningful-state predicates. Jobs evidence considers applicable provider tasks; shared metadata freshness is aggregated once before eligible instance scheduling. No speculative indexes were added.
- **AUD-17:** Docker context excludes `output` and `.data*`, including the pre-existing malformed directory name. Those local files remain untouched.

## Measurements

Disposable PostgreSQL fixtures used 10,000 screen works, JIT disabled as in Coast, and three sequential measured runs per query. These are fixture results, not production latency guarantees.

| Query | Baseline median | Updated median | Work/result evidence |
| --- | ---: | ---: | --- |
| Friend insights | 166.7 ms | 108.3 ms | Same 1,600 result rows; latest-game lookup loops fell from 20,000 to 1,600; unrelated full works/media scans disappeared. |
| Jobs metadata due | 22.6 ms | 13.8 ms | Shared 10,000-record freshness aggregate; two eligible instances returned, paused instance omitted before scheduling computation. |

Admin demand now uses one database projection plus the existing configuration read, rather than one demand projection per selected user. Browser tracing of a watched action recorded one mutation, one route-data refresh and one post-write action-data read, in addition to the initial lazy menu read. Unrelated layout dependencies were not invalidated.

## Verification

- Type/Svelte checks: 0 errors and 0 warnings.
- Production build and generated UI inventory checks pass.
- Default tests and all 27 isolated database suites pass; final counts are recorded in the findings register verification section.
- Desktop/mobile Chromium checked Collection, Library, For You, Jobs and both viewer sections. All 55 standalone component recipes rendered without page errors or iframes.
- Browser fixture audio kept playing through SPA navigation into the controller preview; global fetch and the active session stayed unchanged. A preview favourite action produced no live relationship request.
- Favourite persistence and current lazy watched actions passed. The older generic browser script has stale selectors for the current design; this pass used current selectors in isolated verification rather than changing the interface to satisfy it.
- Resource regressions cover stale responses, replacement/disposal, retained partial results and ordered occurrence deduplication. Client regressions cover injected relationship delivery, targeted invalidation and rejected preview writes. Cache regressions cover concurrent admission, duplicate keys, restored disk budgets and rejected allocation.

This is not live provider acceptance or an exhaustive security certification. Audio evidence here is a browser fixture, not a real Jellyfin stream. Larger deployment-specific plans and provider-account journeys remain later validation work.

## Dependency review (AUD-18)

Two transitive advisories remain explicitly justified, not removed with overrides:

- `cookie@0.6.0` is required by installed SvelteKit 2.70.3. Coast sets a constant session cookie name and path, does not accept a cookie domain/path/name from users, and uses framework serialization. The reviewed advisory's attacker-controlled serialization inputs were not found in Coast. Registry `latest` is SvelteKit 3.0.0, a major framework migration; it is outside this behavior-preserving pass.
- Old `esbuild@0.18.20` comes through Drizzle Kit's `@esbuild-kit` development loader; Drizzle Kit 0.31.11 remains its latest stable release. Coast does not run this old esbuild's development HTTP server. Production builds use the current Vite toolchain. A beta tooling migration or blind transitive override was not introduced.

The advisory presence remains visible in dependency audits. A compatible parent upgrade or a planned framework/tooling migration should revisit these paths; this reachability assessment is not an upstream patch.

## Security review scope

The required independent boundary and candidate reviews completed. Focused privacy/cache regressions passed. The reviewer also questioned whether a deliberately published featured favourite discloses that selected favourite. The original audit explicitly treats featured/background selections as owner-published profile details; this pass preserves that behavior and removes denied ordering/pin identifiers for the rest of the favourites. It does not promise to conceal the owner's explicitly featured selection.

The original completed Security scan stays immutable. Supplemental remediation evidence records these fixes and their limits separately.

## Deferred

Retention/recovery policy, public API grants/idempotency, live integration/social acceptance, accessibility, further playback/QOL investigations and the previously agreed product roadmap remain subsequent passes. No new scheduler, compatibility layer, wrapper-per-variant component or speculative folder framework was introduced.
