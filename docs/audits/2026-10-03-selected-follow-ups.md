# Selected audit follow-ups — 3 October 2026

This pass implements the five selected areas without changing the approved visual design, adding production dependencies, or publishing changes. Other audit work is parked in [the roadmap](../roadmap.md).

## Unused code and consolidation

A source import graph now separates production, admin-preview and tooling consumers. `bun run code:inventory` runs in CI alongside the existing rendered component inventory and TypeScript/Svelte unused-declaration checks. Literal dynamic imports and registered component globs are included. There are no currently unreachable source modules to delete; the requested material experiment/tweaker remains used in the admin reference. This is an import/declaration audit, not proof that every runtime branch is necessary.

Progress charts now use the existing ProgressBar, including its clamping and accessible values. Skeleton paint/animation is shared between shelves, friends and notifications; component-specific geometry remains local. The component reference still verifies all 62 registered components and their composition.

The dev connection-limit failure exposed an unreliable SSR hot-reload pool lifetime. The database pool now belongs to the process, while ORM instances retain their current schema. A module-reload regression test verifies reuse. Disposable test orchestration uses one administrative connection, and browser fixtures close their seeding pool before serving media. Already orphaned connections in the existing dev process remain until that process restarts; this pass did not restart it or terminate its database sessions.

## Accessibility

There is one global skip link, including unauthenticated pages; its target can actually receive focus. Popovers focus their first usable control and restore focus to a connected opener on closing. Skeleton loading is announced without exposing decorative placeholders; reduced-motion preferences stop pulsing. Existing keyboard controls, colors, typography and materials are retained.

Browser checks verified the skip link focusing main content, Escape returning focus to Friends, and reopening the same panel. API settings rendered without overflow at effective viewport widths of 433px and 1600px. The browser clamps/adjusts the requested 390px and 1440px sizes. These are representative keyboard/responsive checks, not a complete screen-reader or real-device accessibility certification.

## Empty shelves

The shared Shelf hides confirmed empty default rows and displays shared skeletons during initial loading. Errors, notices, full grids and user-selected empty filters remain reachable. Refreshes retain existing cards. Custom Reviews/Credits rows provide item counts to the same renderer; credit failures now retain an explicit Retry action.

Medium-aware rows check whether another medium has content before disappearing, so an empty Watching segment cannot hide Playing/Listening data. Personal checks use lightweight activity/relationship evidence; they do not hydrate additional card pages or inspect another profile's private media activity. Social rows check their privacy-filtered all-medium feed only when the selected medium is empty.

## Read-only public API

`/api/public/v1` uses independent, scoped Bearer credentials, owner-only personal reads, explicit DTOs, bounded 60-item pagination, expiry/revocation and an atomic shared quota. API access settings reuse existing fields, checkboxes, buttons and panels. Credentials are shown once and stored only as hashes. Password/admin credential or role changes revoke machine tokens; disabled accounts cannot use them.

Library reads use persisted accessible work identities and their parents, rather than provider music browsing pagination. Games/music respect the experimental gate. No provider credentials, private game notes, streams, cross-profile selection, browser-session authentication or writes are exposed. See [the public API contract](../public-api.md).

Migration 0036 was applied to the existing development `coast` database after disposable database checks. Existing development data was retained.

## Playback evidence

The existing player was exercised with actual synthetic MP4/AAC media and authenticated local streams. Audio decoded, recorded a listen and completed; a second traversal continued playing after route navigation to Library. Video decoded/completed; with its full buffer confirmed, suspending the synthetic upstream provider did not prevent completion or produce a decoder error. Console warning/error logs were empty during the representative UI/playback checks. An initial visit carrying a previous disposable database's session returned 500; signing in with the fresh fixture account restored the preview. This is fixture isolation evidence, not a live-account sign-in acceptance result.

Existing deterministic tests cover actual-play thresholds, crop, buffered failure exhaustion, navigation, source permission and synced-room lifecycle behavior. This pass does not claim live Trakt/Jellyfin, physical desktop/mobile device, HLS outage, or multi-device party certification. Those acceptance checks remain explicitly separate from fixture/browser evidence.

## Verification

- Type checks: zero errors/warnings; production build passed; source/component inventories and whitespace checks passed.
- Default suite: 220 passed, database-only cases skipped, zero failures.
- Full disposable database run: 258 passed across 34 suites, zero failures. Later API, pool reuse and medium-aware shelf changes were rerun in two focused suites: 18 passed, zero failures.
- Built-server HTTP checks: `me`, catalogue, Library, Collection and progress returned 200 with the fixture token; unauthenticated access returned 401 and POST returned 405. Token revoked after the check.
- The final API suite covers hashed credentials, scope/owner boundaries, pagination, account disablement/expiry/revocation, password invalidation, concurrent quotas, private-note exclusion, Library access and process-pool reuse.
- Temporary browser tabs, provider/app processes and disposable databases were cleaned up. Existing port 5173 was retained.
- No commits, pushes, pull requests, deployments or production dependencies were added.

## Additional requested follow-ups

- Optional bounded media-server artwork caching under Policies, retaining authorization checks and server/account-generation isolation. Profile-image storage is unchanged.
- API request lanes now choose priorities between bounded calls: initial imports, interactive work, live observations, then maintenance. An urgent worker is reserved; account writes remain ordered. Pacing, Retry-After cooldowns and starvation protection remain in place. Initial-import completion has durable account-scoped checkpoint evidence.
- Jellyfin and Steam live observations use the existing Jobs system, configurable idle/active cadences and per-connection opt-outs. They do not manufacture history; private/unmapped Steam games remain unresolved.
- Password validation uses 8–128 characters with uppercase, lowercase and special characters; no digit is required.
- For You removes Recently watched, From your library and Because you watched. Activity is last; Dynamic For You is parked on the roadmap.
- Missing-artwork monochrome is an appearance preference and never applies to guests. Public-read-only sites support public catalogue search without querying private accounts or showing server artwork.
- Card heads sit left of progress with a shared bottom edge and an 8px gap. Activity skeletons include attribution/time/reaction shapes; grid skeletons fill the 60-item page and rows render 12 placeholders.

Verification: type/build and inventory checks pass; the complete disposable-database run passed 267 checks, followed by the focused guest metadata fixture. An isolated browser verified appearance settings, guest search and matching avatar/progress bottom edges. Real Jellyfin/Steam live-account acceptance remains unverified. No commits or deployment were made.
