# Collection and Library

Collection is personal saved state and activity. Library is server content accessible to the current user. Metadata ingestion and server presence never create personal membership. This distinction applies to screen media, music and games; future categories add concrete metadata/activity tables under the shared work registry.

## Identity and membership

`works` owns UUID, category and kind, preserving existing screen/game identities and URLs. Concrete tables own metadata and activity. Server item IDs are scoped to the service instance; compatible verified identifiers can merge music mappings. Artists remain credit/browsing entities with separate favourite preferences.

Collected, saved-for-later/watchlist, favourites, ratings, ordered lists and queue membership refer to shared works. Meaningful tracking and retained watches, game sessions and listens also qualify. Empty tracking rows do not. Imported Jellyfin activity can create membership; inventory import alone cannot.

Add to Collection sets direct Collected status. Remove from Collection removes only that status, preserving other relationships and history. Collecting a show or album follows newly discovered members. A relationship to one child can present its parent without selecting siblings. Assessments expose direct, inherited and member-derived reasons.

Collection follows signed-in profile visibility. The profile owner supplies personal reasons; the visitor's permissions determine availability. Game session details and notes remain owner-only. Library exposes Collection through a FolderLibrary toggle beside each row's independent Available toggle. Expanded Watch, Listen and Play rows remain under `/library`; `collection=true` selects personal membership and `username` optionally selects a profile. The shared lazy shelves, segments, filters, arrows and expanded grids present root items rather than seasons or episodes. Filters and counts run before 60-item pagination.

Library defaults to Collection on and Available off; explicit URL filters take precedence. `/settings/collection` controls automatic membership separately for Watch, Play and Listen: saved items, favourites, ratings, lists, queue, in-progress tracking and retained activity. Dropped items default to excluded. Direct Collected status always qualifies. Exclusion changes derived reasons without deleting any relationships or activity. In-progress shows and albums can qualify independently of completed child history. Visitors use the profile owner’s membership rules. Trakt’s personal Collection projection uses the same reasons; managed removals still require its existing preview and revalidation.

## Availability and demand

| State | Meaning |
| --- | --- |
| Available | An accessible leaf, or a group with complete known eligible membership accessible. |
| Partly available | Some group members are accessible, with gaps or incomplete membership coverage. |
| Unavailable | No accessible eligible member, with complete current assessments across selected applicable sources. |
| Unknown | No applicable source, incomplete/stale assessment, or unresolved access/connection failure. |

The general Available filter includes partly available groups. Ready to continue checks the exact next needed item. IGDB metadata and Collected state do not prove game installation; games without an availability-capable source remain Unknown.

Shared Jellyfin metadata scans describe the source account's coverage, never another user's access or complete server inventory. Access freshness comes from successful `jellyfin-user` traversal and its configured cadence, with a two-interval window. Completed traversal or authoritative item evidence can establish disappearance; interrupted traversal cannot. Last-known positive observations survive outages with stale information. Stale negatives cannot establish confirmed missing demand or authorize projection cleanup.

Missing means unavailable to the user from selected sources. Demand selects released next-needed items and saved watchlist titles, excluding completed, dropped and known future releases. Unknown dates and uncertain access are explicit. Administrator demand includes opted-in users, needed titles/reasons, source coverage and request status. Sharing defaults on with opt-out and does not change profile visibility. Demand reads current relationships, activity, membership and connection state. Existing permitted request actions remain explicit; no automatic acquisition occurs.

## Reconciliation and account evidence

Jellyfin activity import defaults on and explicit opt-outs survive reconnect/sign-in. Each connection separately opts into applying meaningful Coast tracking when a mapping appears. User sync can authorize reconciliation; shared scanning cannot. Empty/default remote fields can be filled; divergent non-empty state uses existing conflicts with Manual as the default. Durable intent compacts superseded changes and acknowledges only successful delivery. Remote counts/current state never replace full Coast history or create invented dated plays.

`user_identities` remains the Jellyfin sign-in binding. Separate synchronization accounts bind baselines, delivery and projection ledgers to actual provider accounts and pinned services. Trakt uses its stable account UUID. Same-account reconnect retains evidence after a fresh read; another account gets separate settings/baselines. Account generations prevent old queued or running work from using replacement credentials.

## Trakt Collection projection

Collection import and export have separate preferences. Enabled external imports create Collected relationships except for Coast-generated projection entries, including after reconnect. Tracking and list imports remain independently scheduled; movie/show Collection reads fully paginate.

Export is opt-in, from Collected items (default, without availability filtering), all personal Collection items (optionally available-only), or server items. Source scope dynamically follows eligible linked servers by default; fixed selections remain available. Export selects exact movies/episodes. Parent scopes expand known released members; member-derived parents do not select siblings. Available-only checks each leaf. History, progress, ratings, watchlist and list exports remain independent.

The ledger separates pre-existing entries, confirmed Coast additions and uncertain attribution. Lost responses remain uncertain and require review before managed deletion. Direct remote edits to generated entries become conflicts. Settings previews show additions, removals, unresolved identities and uncertainty. Enabling/changing offers Leave, Remove obsolete Coast-added entries, or Replace all; disabling offers Leave, Remove Coast-added entries, or Clear all. Approved cleanup remains deliverable after disabling export. Versioned previews/actions revalidate account identity and remote state before removals. Outages never shrink projections; intentional source changes preview removals.

Reconciliation, projection, review and cleanup reuse the existing outbox and Jobs controls, including deduplication, service cooldowns, connection ordering and stale-lease protection.

## Application interfaces

| Interface | Purpose |
| --- | --- |
| `GET /api/v1/collection` | Profile-aware pages and category, kind, relationship, activity, availability/source filters. `level=root` selects root presentation; `username` selects a profile. |
| `GET /api/v1/collection/{workId}` | Current user's reasons, rating, queue and list action state. |
| `POST /api/v1/collection/{workId}` | Set direct Collected status with `{ collected: boolean }`. |
| Existing Library API | Accessible server content independent of personal membership. |
| `GET /api/v1/missing` | Personal missing/uncertain demand, source filtering and pagination. |
| `GET /api/v1/admin/demand` | Administrator demand enforcing user opt-outs. |
| Existing settings/connection APIs | Demand sharing, listen threshold, imports and reconciliation preferences. |

Database/provider fixtures cover membership, freshness, account provenance, multi-page imports, projection feedback/conflicts/cleanup and reconciliation. Desktop/mobile fixtures cover root-level lazy rows and playback. See [Readiness](readiness.md) for evidence limits; live Trakt remains deferred and real-server audio remains unverified.
