# Provider imports and job scheduling — 7 October 2026

This records the completed implementation of the Jellyfin onboarding and cross-provider scheduling audit. Verification uses synthetic responses and disposable PostgreSQL databases; it does not promise production import latency. Implemented in this change; the companion package requires installation and a Jellyfin restart to activate its feed.

## Jellyfin inventory reuse and onboarding

A server's full user or shared metadata scan now records its actual screen libraries, not guessed Movies/Shows names or aggregated UserViews. Each library census has a durable page cursor, verified server/version, source account generation, total and completion/expiry marker. Partial or inconsistent pages cannot publish completion. A fresh previous completed evidence slot stays reusable while a new census is in progress; explicit unsupported source evidence invalidates it. Ordinary subsequent metadata updates retain library membership; unsupported source evidence withdraws that proof.

A new account authenticates its own policy and accessible CollectionFolder IDs. It can obtain positive access from a completed current census for those libraries with one local projection. This contains only library access and membership counts: no other user's history, favourites, resume position or file paths are copied. The account's personal bootstrap separately imports watched/resumable/favourite records and can open onboarding before the exhaustive background scan finishes.

Reuse supports library allow/block/subset policies on verified Jellyfin 10.10/10.11 contracts. Unknown versions/policy fields, item-level parental/tag/unrated restrictions, access schedules, device restrictions and incomplete/stale inventory use authenticated traversal. Music remains separate. Census expiry follows the full-refresh cadence plus one recent interval of grace capped at 60 minutes; default 24h10m. Own permissions are fetched fresh. Playback still obtains current upstream access/capabilities.

Inherited evidence never publishes a full-user checkpoint or negative coverage. Collection can use its exact census to establish known show/season completeness while retaining ordinary viewer freshness. Complete user traversal is still required for disappearance. Failed reads, partial imports and sparse personal filters cannot revoke availability.

The joining-account fixture verifies 106 cached titles with no unfiltered `/Items` traversal, complete fresh show/season assessments, no transferred personal completion and no full-user checkpoint. Restricted/subset, changed generation, missing capability, interrupted census, unsupported source and expiry cases are covered. This demonstrates avoided remote work, not measured live-server speed.

## Queue, priorities and safe continuation

- Work identity is service-scoped for shared inventory/metadata tasks and account/generation-scoped for personal imports. Repeated requests reuse work; manual requests promote eligible existing work rather than enqueue duplicates.
- First imports, playback, manual/interactive work, live observations and scheduled maintenance have explicit urgency. Queued HTTP requests reconsider priority between calls. Exact shared resource joins can promote that resource without promoting an entire background task. Local promotion is monotonic.
- Provider origins serialize paced HTTP requests and retain cooldowns/cancellation/fairness. Service traversals run one at a time per instance; unrelated services and live/interactive observations can progress. Mutable account writes preserve their ordering.
- Jobs yield only after replay-safe committed work. A yield releases the lane without counting as a failure attempt or creating an attention notification. Intent is refreshed before the first request and at checkpoints.
- Lease checks and account generation fence personal writes. Steam locks connection then action, matching reconnect/reset lock order. Cancelled, replaced or recovered workers cannot publish ownership removals.
- Jobs presents one compact row per service/task across Running, Waiting, Needs attention, Upcoming and Manual, with completed/eligible users (latest runs) and aggregate account status. Last-run summaries replace history views; outbox job records remain retained. Existing action menus expose Prioritize, Run now, schedule edits and targeted retry; detailed progress and errors open only on request. Waiting text uses the same account barriers as claiming and distinguishes cooldown/backoff, pause, connection attention and capacity. Displayed waiting jobs use the worker’s eligibility predicate: ready work comes first, then held candidates, with priority/ageing inside each group. An already-running account write blocks an older import too.

## Provider-specific changes

| Provider/task | Result |
| --- | --- |
| Jellyfin | Separate essential personal bootstrap from exhaustive access; batch missing metadata, validate offsets/IDs/totals, resume per-library/filter/music/reconciliation stages, compare unchanged baselines in batches and keep scoped membership provenance. |
| Trakt | Durable paged staging for history, progress, ratings, watchlist, collection and lists; activity fences and bounded restart; deterministic history order; committed apply markers; no final negative publication until complete. Token refresh locks only when rotation is required. |
| Steam | Retain the original owned-game census and resume 100-title chunks. Publish ownership/absence only after all chunks. Achievements retain the bounded exact owned AppIDs. Optional IGDB enrichment is separate from personal readiness. |
| IGDB | Remove the hidden adapter FIFO; use the common paced priority lane and preserve typed HTTP failures. Exact Steam identity enrichment rotates attempted misses so unmatched titles do not starve the pool. |
| Seerr | Recheck both linked account generations, owner identity, current job lease and response pagination. Individual missing requests and authentication/outage failures retain distinct meanings. |
| Provider recommendations | Freeze six shared seeds or two personal categories, resume after committed sets without reselection, and fence set publication against account replacement/cancelled workers. |
| TMDB | Locale-scoped artwork fallback. Retain the original finite batch of up to 100 title/region pairs, including forced refreshes; sequential refresh yields safely and preserves item retry evidence. Run now is a bounded batch, not an all-catalogue sweep. |
| User catalogue recovery | Preserve direct remote-reference discovery even with personal imports disabled. Resume category/filter/list/member cursors and hydrate only missing verified roots. No recommendation generation or personal relationship writes. |

All provider calls retain the approved server-only transport and credential boundary. Public API failures use safe messages: upstream authentication/outages do not masquerade as a Coast login failure; rate limits return bounded Retry-After. Raw upstream responses are not exposed.

## Original audit recommendation closure

| Finding | Implementation and acceptance evidence |
| --- | --- |
| Personal jobs collapsed across accounts | Central `job-policy.ts` identity scope; queue and timing DB tests retain separate accounts/generations and deduplicate compatible requests. |
| Bootstrap waited for exhaustive census | Separate `jellyfin.bootstrap` and background `jellyfin.sync`; bootstrap DB tests distinguish personal readiness from complete availability. |
| Rich shared screen projection | Metadata-only Jellyfin projection; adapter query tests preserve authenticated playback capabilities separately. |
| Recent music always traversed the library | Shared metadata time cursor only; query tests keep user-state/access scans independent. |
| Unchanged values repeatedly reconciled | Batched baseline comparison and safe empty-baseline seeding; Jellyfin reconciliation tests preserve local intents and conflicts. |
| Scheduling conflated account/service scope | Shared identity, task eligibility and timing; manual/timer/read-model acceptance tests. |
| Whole jobs monopolized workers | Committed yield boundaries, durable Trakt staging and Steam snapshots; queue, staging, catalogue cursor and recommendation resume fixtures. |
| Missing identities required one request each | Authenticated Jellyfin batches of at most 100; query and persistence tests. |
| Malformed pagination published completion | Offset, total, unique ID and premature-empty guards; adapter tests. Upstream snapshot limits remain below. |
| A disappearing item failed the scan | Narrow typed individual 404/410 handling; shared endpoint/auth failures still fail safely. |
| Membership counts were globally recomputed or shared as permission proof | Account-generation provenance and touched-parent updates; Collection and access-proof fixtures verify completed library reuse. |
| Duplicate timing policies | `task-timing.ts` supplies scheduler and Jobs read model; pure and DB timing tests. |
| Progress confused partial and full completion | Queue-first Jobs and explicit bootstrap/stage counters; timing tests and desktop/mobile isolated interactions. |
| Shared music snapshots contained personal state | Metadata-only serialization with separate account observations; music persistence DB tests. |

The cross-provider findings are covered above: Seerr scope/lease guards, IGDB common request arbitration and typed errors, separate Steam enrichment, scoped TMDB locale fallback, unlocked valid Trakt token reads and intent-aware exact-resource singleflight. Catalogue recovery intentionally retains direct remote references when personal imports are disabled; removing that behavior would conflict with the chosen task semantics.

## Verification and limits

Focused disposable database suites cover bootstrap/cache, queue ordering/deduplication/promotion/yields, Steam ownership/achievements/cancellation, Trakt staging and list edits, catalogue cursor/refresh recovery, generation fences and Collection availability. Unit tests, Svelte type checks, component inventory and production build pass. The Jobs desktop/mobile interaction check used an isolated mocked-API fixture.

Upstream offset pagination and activity fences do not create true remote snapshot isolation; same-sized concurrent changes can evade simple total checks. An individual Trakt list's final replacement remains atomic, although its pages and mappings yield. Request arbitration is process-local; multiple application processes require shared HTTP coordination before increasing deployment concurrency. A crash between metadata refresh and its cursor can replay shared metadata safely. Seerr's bounded request census still traverses its pages in one pass; per-page staging is a measurement follow-up if request counts make it materially long. It confirms omissions individually before cancellation. Explicit non-job bulk helpers retain their existing direct-call semantics. Production throughput, memory and interactive latency still need separate measurement.

See [job scheduling](../job-scheduling.md), [provider contracts](../providers.md), [Collection freshness](../collection.md) and [performance methods](../performance.md).
