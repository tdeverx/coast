# Core audit implementation

All 57 canonical findings from findings.json; existing unrelated work preserved.

All 57 canonical findings are implemented. Final integrated checks passed.

## Resolution ledger

| Finding | Change | Verification |
| --- | --- | --- |
| CROSS-03 | Transaction-local configuration and sequence reads; bounded same-account pool liveness. | audit-boundaries-db,sequence-transaction-db |
| DOMAIN-01 | Reuse the existing instance-scoped Jellyfin canonical identity on repeated conflict. | provider-db |
| JOBS-01 | Deliver Seerr requests through the pinned account context without reacquiring its lane. | seerr-delivery-db |
| JOBS-02 | Acknowledge only the list snapshot that was actually transmitted. | jobs-list-delivery-db |
| JOBS-03 | Reconcile only provider-representable screen members, preserving unsupported members. | jobs-list-delivery-db |
| API-01 | Manual webhook retry grants a fresh bounded budget while retaining monotonic lease attempts. | audit-boundaries-db,webhooks-db |
| AUTH-01 | Reset an explicit preference allowlist, preserving privacy and administrator policy. | settings-db |
| AUTH-02 | Use the existing disconnect/reconnect lifecycle for failed onboarding authentication. | audit-auth-discovery-db |
| AUTH-03 | Reject completed setup before form/hash work and rate-limit fresh setup attempts. | setup-action,audit-auth-discovery-db |
| CROSS-01 | Gate Open Library by the resolved work medium rather than its provider name. | experimental-features,audit-auth-discovery-db |
| CROSS-02 | Resolve registered secondary reading identities locally before remote metadata. | audit-auth-discovery-db |
| DISCOVERY-01 | Map IGDB hits to one canonical owned game before merging provider results. | audit-auth-discovery-db |
| DISCOVERY-02 | Invalidate Discover caches on content/source revision, category and viewer changes. | ui-discovery-source |
| DISCOVERY-03 | Apply positive recommendation evidence before the bounded candidate cutoff. | audit-auth-discovery-db,taste-cache-db |
| DOMAIN-02 | Exclude private playlist planning/context from visitor progress. | audit-boundaries-db |
| DOMAIN-04 | Hydrate actual TMDB IDs for actionable refresh targets. | audit-boundaries-db |
| DOMAIN-05 | Use one effective release-date precedence in menus and tracking; decode dates consistently. | audit-boundaries-db,media-actions-db |
| DOMAIN-06 | Refresh parent completion after new episodes; stable parent and projection fences prevent concurrent stale writes. | audit-boundaries-db |
| DOMAIN-07 | Filter permitted filmography IDs before counting, paging and hydration. | domain-application-db |
| INFRA-01 | Bound buffered provider responses by a total deadline, including slow-drip bodies. | platform-security |
| INFRA-02 | Record new migrations and a current generation snapshot; no-op generation regression. | migration-generation |
| INFRA-03 | Only the current main revision may update the mutable preview image tag. | static workflow review |
| JELLYFIN-01 | Export numeric committed progress and duration, including explicit zero resets. | jellyfin-progress-export-db |
| JELLYFIN-02 | Persist private per-copy observations and aggregate canonical music state across pages/deltas. | jellyfin-recovery-db,jellyfin-music-persistence-db |
| JELLYFIN-03 | Fence user baseline resets and queue a fresh traversal after stale completion races. | jellyfin-recovery-db,jellyfin-companion-db |
| JELLYFIN-04 | Retain sanitized DeviceId for shared-stream session deduplication. | jellyfin-companion,plugin build |
| JELLYFIN-05 | Require stable totals and unique observed IDs before negative music/reading coverage. | jellyfin-recovery-db |
| JOBS-04 | Commit list changes and durable export intent in the same transaction. | jobs-list-delivery-db |
| JOBS-05 | Guard Seerr publication with account and worker lease authority. | seerr-delivery-db |
| LIFECYCLE-01 | Abort/invalidate pending media and reader preparation, capture request authority, and retire late sessions. | media-lifecycle-client,playback-generation-db,ui-client,media-lifecycle-client |
| MEDIUM-01 | Keep a selected release and exact ordered track occurrences rather than merged release membership. | jellyfin-music-persistence-db,music-presentation |
| MEDIUM-02 | Normalize and index equivalent Jellyfin GUIDs; reject conflicting canonical mappings. | jellyfin-music-persistence-db |
| MEDIUM-03 | Use source/occurrence entry IDs for merged music card renderer keys. | jellyfin-music-persistence-db |
| MEDIUM-04 | Scope Steam observations and achievements by exact AppID; discard ambiguous imports for authoritative resync. | steam-db |
| PLAYBACK-01 | Pin personal playback to account generation at admission, progress, relay, party and scrobble boundaries. | playback-generation-db |
| PLAYBACK-03 | Audio retry prepares a replacement session instead of resuming the failed one. | media-lifecycle-client |
| PLAYBACK-04 | Coalesce maintenance passes and run bounded shared cleanup independently. | maintenance-lifecycle |
| READING-01 | Keep failed final bookmark state and retry UI instead of silently closing it. | media-lifecycle-client,media-lifecycle-client |
| READING-03 | Serialize bookmark copying and session insert with Reread on the same owner lock. | reading-sessions-db |
| READING-04 | Hand over current reading source before retiring it; preserve only authorized live membership. | reading-sessions-db |
| SOCIAL-01 | Invalidate failed party source cache when its exact descriptor changes. | synced-client |
| SOCIAL-02 | Acquire friendship before recommendation locks consistently for send and response. | audit-boundaries-db,social-db |
| SOCIAL-03 | Aggregate exact counts/pages in SQL and hydrate bounded visible evidence and page IDs. | audit-boundaries-db,social-db |
| SOCIAL-04 | Read actual music progress rather than generic saved-state zeros; unknown duration stays zero. | audit-boundaries-db |
| UI-01 | Dismiss ordinary menu actions by default; explicitly retain continuous controls and dialog boundaries. | ui-client; rendered synthetic browser verification |
| UI-02 | Isolate preview presence, sharing, logout and media navigation from real application state. | ui-client; rendered synthetic browser verification |
| API-02 | Treat HEAD as authenticated readable routing and return only status/headers. | public-api-db |
| AUTH-04 | Exclude disabled administrator targets from the last-active-administrator guard. | audit-boundaries-db |
| AUTH-05 | Supply all setup fields in HTTP/browser fixtures and only fall back to login on existing-setup conflict. | audit-auth-discovery-db,setup-action; HTTP fixture review |
| DISCOVERY-04 | Update stale Search and six-medium taste assertions to the actual contracts. | domain-application-db,taste-cache-db |
| DOMAIN-08 | Enforce playlist initial-member rules atomically with creation. | jobs-list-delivery-db |
| INFRA-04 | Apply the taste admission uniqueness constraint to the real outbox; retain terminal history. | audit-boundaries-db,taste-cache-db |
| MEDIUM-05 | Hydrate canonical role-specific artist credits and authorized artist destinations. | jellyfin-music-persistence-db,music-presentation |
| MEDIUM-06 | Remove obsolete verified game parent links on authoritative metadata refresh. | taste-cache-db |
| STRUCT-01 | Document authoring conventions and incrementally check compound statements using the installed TypeScript parser. | source-style,code:style |
| STRUCT-02 | Own the pure cancellation helper beside reader engines, preserving lazy format dispatch. | reading-reader |
| UI-03 | Document current mobile icon navigation and the four supported material treatments. | design guide and material inventory review |

## Boundaries and limitations

- Provider behavior tested with synthetic transports, not live accounts.
- UI verification uses rendered synthetic fixtures; it is not full live-device/provider acceptance.
- The workflow publication change is statically reviewed; no GitHub workflow was triggered.
- Offset scans detect changed totals/repeated IDs, not every possible same-cardinality upstream reordering.
- The style guard is deliberately incremental, not a repository-wide formatter.
- Steam ambiguous imported totals/achievements are discarded by migration per user instruction; ordinary sync restores attributable observations. Manual history is retained.

No commit, push, deployment, or dev/live database migration was performed. Three new migrations (0052–0054) are prepared but have not been applied to dev/live.

## Final verification

- Default suite: **423 passed**, 585 opt-in cases skipped, zero failures.
- Disposable PostgreSQL: **536 passed** across 76 suites, zero outstanding failures. The full run exposed stale reused party fixtures; both changed suites passed their final rerun. The test container was restored to stopped.
- Typecheck: zero errors and warnings. Production build passed; the existing large lazy-reader chunk warning remains.
- UI inventory, unused-module inventory, incremental source-style guard and whitespace checks passed.
- Plugin: build passed without warnings; 11 journal checks passed.
- Migration generation produces no new statements against the current snapshot.

See [machine-readable verification](implementation-checks.json) and the individual implementation reports for exact scopes. Real provider/device acceptance and a complete HTTP/browser journey were not run.

## Publishing verification

Integrated current main (`b7e9d86`) and verified on Bun 1.4.3: **449 regular tests and 540 disposable database tests passed**, zero failures; typecheck/build/inventories/style checks passed. The 77 database suites completed in one full run and the test container was restored to stopped. Main’s runtime diagnostics, shutdown/readiness fixes, recovery priorities and PostgreSQL 15/17 CI remain intact. See [publishing verification](push-verification.json). No dev/live migration or deployment was performed.
