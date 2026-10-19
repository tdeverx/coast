# Full finding and opportunity register

Source and runtime boundaries are in [the main report](README.md). Current implementation and outstanding acceptance are tracked in [the implementation ledger](implementation-ledger.json). Status and implementation flags below reflect that overlay; audit-time evidence fields remain historical. This is a register of **94 recorded items**, including overlaps, small opportunities and plan-gated leads; it is not 94 independently verified production defects. Canonical owners and complete acceptance live in the linked detailed reports. Every accepted fix must cover all of its consumers.

| ID | Priority / type | Shared plan | Finding / opportunity | Analysis | Current status |
| --- | --- | --- | --- | --- | --- |
| DATA-01 | P1 | W01 | public API writes can deadlock with ordinary tracking through inverted owner locks | [data-api](data-api.md) | implemented-actual-data-verified |
| DATA-02 | P1 | W05 | sequence-context tracking repeatedly expands the complete sequence; bulk collection completion is quadratic in transferred sequence rows | [data-api](data-api.md) | partial-actual-data-verified |
| DATA-03 | P2 | W06 | list removal and reorder issue one update for every member under an owner-wide lock | [data-api](data-api.md) | partial-shared-source-applied-actual-empty-cohort-verified |
| DATA-04 | P2 | W05 | initial screen details materialize complete child and overlapping parent-collection cards | [data-api](data-api.md) | partial-actual-data-verified |
| DATA-05 | P2 | W02 | Continue and the initial home hero still plan from the owner's complete screen state and descendant sets | [data-api](data-api.md) | partial-actual-state-admission-verified |
| DATA-06 | P2 | W02 | received-recommendation progress fetches all candidates and assesses all candidates before paging | [data-api](data-api.md) | open |
| DATA-07 | P2 | W06 | several unchanged operations still perform physical updates, timestamps and downstream work | [data-api](data-api.md) | partial-profile-noop-and-feature-bindings-actual-rollback-verified |
| DATA-08 | P2 | W06 | requesting one screen discovery bucket prepares and persists both buckets | [data-api](data-api.md) | implemented-actual-retained-snapshot-replay-verified |
| DATA-09 | P2 | W08 | inline raster avatars amplify settings reads and repeated social payloads | [data-api](data-api.md) | open |
| DATA-10 | P2 | W01 | unchanged browser session authentication takes a row mutex on every request | [data-api](data-api.md) | implemented-actual-data-verified |
| DATA-11 | P3 | W08 | shared card hydration activates medium-specific query owners for unrelated identities | [data-api](data-api.md) | implemented-actual-data-verified |
| DATA-12 | P3 | W05 | a playlist-start command reads the complete list to inspect one header field | [data-api](data-api.md) | partial-shared-source-applied-actual-empty-cohort-verified |
| DATA-13 | P3 | W08 | profile activity/favourite section refreshes still compute discarded presentation data | [data-api](data-api.md) | implemented-actual-equivalence-verified-coverage-gaps |
| DATA-14 | P1 | W02 | shared assessment repeats show eligibility per episode and expands broad evidence for item reads | [data-api](data-api.md) | partial-actual-data-verified |
| HELPER-01 | P3 | W08 | Menu scopes serialize full user settings per consumer | [data-api](data-api.md) | partial-avatar-scope-serialization-actual-settings-verified |
| HELPER-02 | P3 | W09 | Closed menu controllers retain individual breakpoint listeners | [data-api](data-api.md) | implemented-regression-verified |
| HELPER-03 | P3 | W03 | Presence heartbeat does not recheck owner after awaiting reply | [data-api](data-api.md) | implemented-regression-verified |
| HELPER-04 | P3 | W08 | Request labels repeat destination-set construction | [data-api](data-api.md) | implemented-actual-labels-verified-scale-gap |
| HELPER-05 | P3 | W12 | Queue actions publish feedback outside preview client scope | [data-api](data-api.md) | implemented-regression-verified |
| MIN-01 | P3 | W08 | A status-filtered game preview calls listGames for a 60-record page, including presentation metadata, then returns12. | [data-api](data-api.md) | implemented-actual-equivalence-verified-scale-gap |
| MIN-02 | P3 | W08 | An episode menu hydrates its own card, whole-show card, then parent cards; the same show can be hydrated in both calls. | [data-api](data-api.md) | implemented-actual-data-verified |
| MIN-03 | P3 | W08 | Catalogue and accessible-library responses use full workCards then the non-personal DTO discards state, artwork, credits and most metadata. | [data-api](data-api.md) | partial-actual-data-verified |
| MIN-04 | P3 | W08 | A source change sends one notification operation per affected user, each independently reading config/preferences. | [data-api](data-api.md) | partial-actual-data-verified |
| MIN-05 | P3 | W08 | Admin health latency includes three sequential queries, and the action-state count scans durable job history. | [data-api](data-api.md) | partial-actual-data-verified |
| MIN-06 | P3 | W08 | Continue removal reads every owner's queued item, then filters to actual removed IDs. | [data-api](data-api.md) | partial-shared-predicate-applied-actual-empty-queue-verified |
| MIN-07 | P3 | W08 | Up to20 friend relationships are checked serially twice during creation, then reminders notify up to21 users serially. | [data-api](data-api.md) | partial-planning-friend-admission-actual-verified |
| MIN-08 | P3 | W08 | Feature overlap uses av.filter(...bv.some(...)); per dimension up to500 affinities gives250,000 comparisons. | [data-api](data-api.md) | implemented-completed-actual-cohorts-verified |
| PLAN-01 | measurement-gated | W12 | Collection assessment | [data-api](data-api.md) | overlap-measured |
| PLAN-02 | measurement-gated | W12 | activityFeed | [data-api](data-api.md) | partial-actual-data-verified |
| PLAN-03 | measurement-gated | W12 | Taste staleness/ranking | [data-api](data-api.md) | open |
| PLAN-04 | measurement-gated | W12 | Recommendation scoring | [data-api](data-api.md) | partial-actual-data-verified |
| PLAN-05 | measurement-gated | W12 | Feed definition census | [data-api](data-api.md) | partial-interest-input-actual-verified |
| PLAN-06 | measurement-gated | W12 | Admin missing demand | [data-api](data-api.md) | partial-actual-data-verified |
| PLAN-07 | measurement-gated | W12 | Notification summary + page | [data-api](data-api.md) | overlap-measured |
| PLAN-08 | measurement-gated | W12 | Profile insight aggregations | [data-api](data-api.md) | partial-actual-data-verified |
| PLAN-09 | measurement-gated | W12 | Deep numbered pages | [data-api](data-api.md) | open |
| PLAN-10 | measurement-gated | W12 | Presence/read freshness | [data-api](data-api.md) | open |
| PJ-01 | P2 | W03 | private artwork cancellation is owned by the first caller | [providers-jobs](providers-jobs.md) | implemented-actual-byte-replay-verified |
| PJ-02 | P2 | W04 | crop cache does not provide true single-flight | [providers-jobs](providers-jobs.md) | partial-regression-verified |
| PJ-03 | P2 | W04 | crop processes and retained results lack aggregate bounds | [providers-jobs](providers-jobs.md) | open |
| PJ-04 | P2 | W10 | Comic Vine search waits on optional enrichment | [providers-jobs](providers-jobs.md) | open |
| PJ-05 | P2 | W06 | one Trakt value can require a full account walk | [providers-jobs](providers-jobs.md) | open |
| PJ-06 | P2 | W06 | Trakt list delivery still rebuilds full identities and rewrites converged lists | [providers-jobs](providers-jobs.md) | partial-shared-identity-batch-actual-verified |
| PJ-07 | P2 | W07 | Jellyfin final reconciliation escapes page/transaction budgets | [providers-jobs](providers-jobs.md) | open |
| PJ-08 | P2 | W06 | a single music track can materialize 10,000 listens in one transaction | [providers-jobs](providers-jobs.md) | open |
| PJ-09 | P2 | W06 | final shared-library membership update rewrites matching parents and correlates child counts | [providers-jobs](providers-jobs.md) | open |
| PJ-10 | P2 | W07 | Jobs terminal representatives scan and spill permanent history | [providers-jobs](providers-jobs.md) | open |
| PJ-11 | P2 | W07 | Steam rewrites growing immutable snapshot content when only its cursor changes | [providers-jobs](providers-jobs.md) | implemented-actual-data-verified |
| PJ-12 | P2 | W08 | list conflicts have no page bound and hydrate complete local membership per conflict | [providers-jobs](providers-jobs.md) | open |
| PJ-13 | P3 | W08 | review pagination refetches invariant TMDB detail and credits | [providers-jobs](providers-jobs.md) | open |
| PJ-14 | policy | W03 | queued provider time has no caller deadline | [providers-jobs](providers-jobs.md) | open |
| PJ-15 | P2 | W07 | bulk task controls select all matching jobs and execute serial transactions | [providers-jobs](providers-jobs.md) | open |
| PR-01 | P1 | W04 | EPUB asset object URL cleanup failure | [playback-readers](playback-readers.md) | implemented-actual-acceptance-pending |
| PR-02 | P2 | W03 | Hung control report blocks Stop and queues lifecycle events | [playback-readers](playback-readers.md) | open |
| PR-03 | P2 | W03 | Reader heartbeat overlap and no teardown abort | [playback-readers](playback-readers.md) | implemented-actual-acceptance-pending |
| PR-04 | P2 | W03 | Missing cancellation at music/trailer request boundaries | [playback-readers](playback-readers.md) | partial-regression-verified |
| PR-05 | P2 | W06 | Serial rich music persistence and per-source page growth | [playback-readers](playback-readers.md) | partial-actual-snapshot-binding-verified |
| PR-06 | P2 | W04 | EPUB preflight and assets scale with full expanded archive | [playback-readers](playback-readers.md) | open |
| PR-07 | P2 | W04 | Native comic forward display depends on storage order | [playback-readers](playback-readers.md) | partial-regression-verified |
| PR-08 | P2 | W03 | Room wide reconciliation per participant heartbeat | [playback-readers](playback-readers.md) | open |
| PR-09 | P3 | W08 | Reading range/HEAD metadata authorization amplification | [playback-readers](playback-readers.md) | partial-actual-data-and-live-verified |
| PR-10 | P3 | W08 | Full provider snapshot hydration per playback relay request | [playback-readers](playback-readers.md) | implemented-actual-acceptance-pending |
| PR-11 | P2 | W05 | Queue materialization silent cap and whole sequence validation | [playback-readers](playback-readers.md) | partial-actual-data-verified |
| PR-12 | P3 | W09 | One hidden hero source/crop sampler retained | [playback-readers](playback-readers.md) | partial-regression-verified |
| PR-13 | P3 | W04 | Post-decode comic dimension guard cannot bound peak allocation | [playback-readers](playback-readers.md) | open |
| PR-14 | P3 | W07 | Evidence/session growth and history late page plans | [playback-readers](playback-readers.md) | open |
| UIS-01 | P3 | W09 | toast suppression remembers every historical ID | [ui-second-pass](ui-second-pass.md) | implemented-normal-rollout-common-and-authenticated-inbox-verified; actual-toast-cohorts-partial |
| UIS-02 | P3 | W03 | browser diagnostics poll in hidden tabs and permit overlap | [ui-second-pass](ui-second-pass.md) | implemented-regression-verified |
| UIS-03 | P2 | W09 | append retains all loaded items and card owners | [ui-second-pass](ui-second-pass.md) | partial-bounded-library-collection-actual-data-verified |
| UIS-04 | P3 | W09 | card/shelf demand is latched after first contact | [ui-second-pass](ui-second-pass.md) | partial-open-menu-material-live-and-regression-verified |
| UIS-05 | P3 | W10 | empty compact charts still request an engine | [ui-second-pass](ui-second-pass.md) | implemented-regression-verified |
| UIS-06 | P3 | W09 | scheduling is shared, but native SVG still rebuilds and has no pixel budget | [ui-second-pass](ui-second-pass.md) | partial-regression-verified |
| UIS-07 | P2 | W04 | avatar compressed-byte bound does not bound decode memory/lifetime | [ui-second-pass](ui-second-pass.md) | partial-actual-native-lifetime-verified |
| UIC-01 | P3 | W08 | Menu identity repeatedly serializes complete unrelated user settings | [ui-components](ui-components.md) | partial-avatar-scope-serialization-actual-settings-verified |
| UIC-02 | P2 | W03 | Request dialog abandons option reads without aborting them | [ui-components](ui-components.md) | implemented-live-verified |
| UIC-03 | P2 | W06 | Grouped recommendation responses refresh once per recommendation ID | [ui-components](ui-components.md) | partial-shared-logical-refresh-applied-regression-verified |
| UIC-04 | P2 | W08 | Collection export preview returns full entries and mounts unbounded review panels | [ui-components](ui-components.md) | open |
| UPP-01 | P2 | W11 | shared chart model lacks family work and generated-mark budgets | [ui-preview-platform](ui-preview-platform.md) | open |
| UPP-02 | P3 | W11 | custom preview JSON and image imports bypass finite fixture bounds | [ui-preview-platform](ui-preview-platform.md) | open |
| UPP-03 | P3 | W11 | bounded diagnostic store repeats filesystem and full-tail parsing work | [ui-preview-platform](ui-preview-platform.md) | partial-actual-data-verified |
| UPP-04 | P3 | W12 | recovery drill captures stdout and stderr sequentially | [ui-preview-platform](ui-preview-platform.md) | implemented-actual-data-restore-verified |
| FRT-01 | P2 | W10 | Selected search medium still starts other enabled searches | [frontend-routes](frontend-routes.md) | partial-actual-data-and-live-verified |
| FRT-02 | P2 | W10 | Public details activate private enrichment and false expiry handling | [frontend-routes](frontend-routes.md) | implemented-live-verified |
| FRT-03 | P2 | W03 | Profile reads and onboarding polling bypass shared cancellation ownership | [frontend-routes](frontend-routes.md) | partial-read-lifetimes-actual-contract-verified |
| FRT-04 | P2 | W10 | Lazy component imports have no scoped error and retry state | [frontend-routes](frontend-routes.md) | partial-shared-import-reload-built-actual-verified |
| FRT-05 | P2 | W10 | Public detail ancestry includes recommendation edges and can replace the hero title | [frontend-routes](frontend-routes.md) | implemented-live-verified |
| LIVE-01 | P1 | W03 | Section-to-detail replacement invalidates an outgoing Shelf source and blocks navigation | [frontend-live](frontend-live.md) | implemented-live-verified |
| LIVE-02 | P1 | W08 | Linked reading candidate metadata is spread into a strict session command and blocks Read | [reading-live](reading-live.md) | implemented-live-verified |
| LIVE-03 | P3 | W12 | Development reload activity confounded initial Reader lifecycle measurement | [reading-live](reading-live.md) | investigation-boundary |
| PANEL-01 | P2 | W09 | Small reverse detail-sheet scrolling snaps immediately back to the expanded position | [panel-scroll](panel-scroll.md) | implemented-live-verified |
| LOCK-01 | P2 | W01 | Account-first commands later acquire the shared policy fence | [mutation-locks](mutation-locks.md) | implemented-representative-actual-data-verified |
| LOCK-02 | P2 | W01 | Concurrent token creators upgrade shared user locks for quota serialization | [mutation-locks](mutation-locks.md) | implemented-actual-data-verified |
| LOCK-03 | P2 | W01 | Steam ownership publication holds a connection before nested account admission | [mutation-locks](mutation-locks.md) | source-order-inversion-runtime-unverified |
| LOCK-04 | P2 | W01 | Social commands lock friendship rows before later policy admission | [mutation-locks](mutation-locks.md) | source-order-inversion-runtime-unverified |

## Deduplication and task use

Implement by W01–W12 in the main report. For example, DATA-02 and the screen-sequence portion of PR-11 share one sequence repair; DATA-07/PR-05/PJ import cases share canonical no-op/batching requirements; PR-02/03/04/PJ-01/UIS-02/UIC-02/FRT-03 share request lifetime contracts but retain distinct required policies; UIC-01/HELPER-01 overlap settings scope serialization. Do not sum those entries as separate gains.

PLAN leads remain in the register to make future review visible; a matching promoted finding such as DATA-14 takes precedence over its earlier measurement-gated query-family lead. Planning or implementing an item must link its actual-data workload, all consumers, behavior invariants, evidence status and open acceptance gaps.
