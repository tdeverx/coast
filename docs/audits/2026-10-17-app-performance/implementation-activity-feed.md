# PLAN-02: skip unused activity root-parent lookups

The shared [activityFeed owner](../../../src/lib/social/queries.server.ts#L28) now reads a `contains` parent only when neither the episode nor season already supplies the root. This is one predicate inside the existing lateral query. All **42 complete actual-data comparisons matched**, and both initial and late-cursor plans reduced parent scans from **13,902 to 1,558**. [Machine-readable scope and source pins](implementation-activity-feed.json).

This is a **partial PLAN-02 repair**. Complete visible histories still pass through privacy checks, deduplication, sorts, windows and grouping before the 61-row lookahead. The candidate's largest actual primary query still took roughly 5.5 seconds in the warm samples. No raw-event limit, grouped cache, durable projection, schema, dependency, UI or privacy change was introduced.

## Exact shared contract

The unchanged root expression is `coalesce(e.show_id,se.show_id,r.parent_id,a.work_id)`. The parent lookup's result can only be consumed when both preceding values are null. Adding `e.show_id is null and se.show_id is null` **inside** that lookup prevents reading an unused value. The original scope-preferred parent, position/UUID ordering and limit remain. No other predicate uses `r.parent_id`.

The owner serves the authenticated social feed and its shared [social shelf](../../../src/lib/ui/shelves/social.svelte.ts): Activity rows/grids, medium selection, friend/kind/period filters, item Activity and relationship views. [Notification inbox hydration](../../../src/lib/server/notifications/inbox.ts#L54) uses the same function with explicit activity IDs. All benefit through this owner; no consumer-specific path or cache was added. Popular-with-friends has a different owner and is not claimed here.

Jellyfin observation deduplication, three-hour episode runs, album batch identity, repeated-listen numbering, exact member IDs, unknown-date sorting, period boundaries, relationship fallbacks, reaction representatives, privacy/features and the cursor tuple are unchanged. All full card, actor and reaction fields remain; no reads are reused between calls. Default planner behavior is retained: the probe used the existing JIT-off policy and did **not** borrow Collection's recursive planner factor.

## Actual cohort and complete results

The [census](evidence/implementation-activity-feed-census.json) used four saved viewers in the approved actual-data clone, a reserved repeatable-read READ ONLY transaction and verified 10s statement / 1s lock budgets. It rolled back and closed. No catalogue, settings, friendship, history, reaction or provider state was fabricated or changed.

| Viewer ordinal | Visible raw events | Root already supplied by episode/season | Parent fallback still admitted | Unknown-date events |
| --- | ---: | ---: | ---: | ---: |
| 0 | 13,902 | 12,344 | 1,558 | 1,152 |
| 1 | 13,224 | 11,743 | 1,481 | 1,144 |
| 2 | 2,024 | 792 | 1,232 | 1,152 |
| 3 | 13,902 | 12,344 | 1,558 | 1,152 |

There were five accepted friendships out of six saved relationships, four activity-reaction rows covering three targets, three visible listens and one reading activity. **No actual multi-track album batch or repeated dated listen** exists in this census; all three visible listens have unknown dates. The selected event cohorts also contain no album or season event. These are verification gaps, not invented positive passes.

Before editing production, the [private candidate probe](evidence/implementation-activity-feed-actual.json) loaded pinned production source bodies, relocated static imports to the current canonical dependencies and compared baseline/candidate functions in one reserved READ ONLY snapshot. It made **42 strict deep comparisons** of the entire returned object:

- Four first pages and four pages using their returned cursor.
- All 16 self/other friend-filter combinations; two excluded cross-viewer combinations remain exactly empty.
- Four media categories, month/year periods and watch/listen kinds.
- Actual comic, episode, game and track item scopes, plus a populated show scope.
- All/consumed relationship scopes, including the extra relationship-only card.
- An actual unknown-date tuple boundary and the next cursor returned from that page.
- All three existing reaction targets through `activityIds`, preserving the inbox hydration contract.

Forty comparisons returned cards; 29 included grouped events, 11 included unknown dates and 10 included the viewer's reaction. Complete members, captions, identities, avatar/status fields, cursor/hasMore values and all other DTO fields were compared in memory and discarded. No provider fetch occurred. Seven shared source hashes remained stable throughout. The full initial DTO was unchanged at 1,716,425 serialized bytes for the selected viewer; this change does not claim a smaller response.

## Verified read work and elapsed boundary

Both plans retained the exact primary feed SQL and actual parameters, with only the proposed lateral predicate differing. Plan output retains whitelisted node/relation/index names and numeric metrics; predicates, SQL parameters and personal payloads are omitted.

| Actual primary-query observation | Before | Candidate |
| --- | ---: | ---: |
| Parent `media_relationships` scan loops, initial and late cursor | 13,902 | 1,558 |
| Parent scan shared-buffer hits, each plan | 528,276 | 59,204 |
| Whole initial plan shared-buffer hits | 1,380,991 | 913,932 |
| Whole late unknown-date plan shared-buffer hits | 1,379,962 | 913,343 |
| Four alternating warm primary-SQL pairs, median | 6,596.827ms | 5,544.724ms |

The target remained a sequential scan with 4,051 rows removed by its filter per admitted loop. The reduced inner loops and buffer hits establish avoided reading, rather than merely dropping projected rows. Its Shared Read Blocks were zero in both versions. Other whole-plan Shared Read Blocks vary with cache state and are not presented as physical-disk I/O; PostgreSQL reads may be served by the OS cache. PostgreSQL's rounded `Actual Rows: 0` at this scan is not proof that every lookup has no result.

One brief [aggregate liveness observation](evidence/implementation-activity-feed-liveness.json) overlapped an EXPLAIN: it found one active query, age 1 second, in the exact activity/EXPLAIN family after 323 seconds of transaction lifetime. The run was productive; its full DTO loop had completed. No query text, PID, private ID or row payload was retained. Treat the four EXPLAIN elapsed values as supplementary because the exact overlapping plan is not identified. The eight alternating warm samples ran after that metadata connection closed. They measure local primary-SQL round trips, excluding card hydration, HTTP, browser rendering, CPU/RSS and WAL. They do not promise a universal elapsed improvement.

Two earlier private setup attempts failed before any feed comparison because a broad import-rewrite regex mistook SQL `substring(... from '...')` for a module import. Their [first](evidence/implementation-activity-feed-probe-setup-failed-1.json) and [second](evidence/implementation-activity-feed-probe-setup-failed-2.json) receipts are retained. Restricting relocation to static import statements fixed the harness. This is not an application failure. All connections from all attempts closed; no database write occurred.

## Regression and maintenance

The new [guarded regression](../../../tests/activity-feed-fallback-db.test.ts) protects show-root precedence despite conflicting `contains` parents, ordinary and scope-preferred fallback ordering, fresh fallback after membership changes, grouped episode members/caption and the representative reaction. Its authored setup explicitly refuses the actual-data clone. It was **one guarded skip**, not executed fixture acceptance. The focused run passed eight existing tests / 53 assertions with no failures. Existing authored `for-you-db` cases cover album membership, repeated listens, episode gaps and known/unknown cursor behavior; they were not run against actual data as performance fixtures.

Production adopted the exact candidate hash only after the actual proof passed. Independent read-only source/probe and source/test reviews found no material issue; neither reviewer repeated tests or touched the database. Root owns combined gates and any normal-browser acceptance.

The [exact executed census](probes/activity-feed-census.ts), [pre-adoption candidate probe](probes/activity-feed-candidate-actual.ts), [liveness probe](probes/activity-feed-liveness.ts) and [captured baseline](candidates/activity-feed/queries.before.ts.txt) are retained. The historical candidate probe intentionally requires the former production pin. The [maintained post-adoption replay](probes/activity-feed-real.ts) reads that baseline artifact, requires the current candidate pin and checkpoints aggregate progress after each pair. It was syntax checked without another database run; those path/admission/progress changes do not constitute a second actual-data pass.

The remaining options stay open. A further page-plan rewrite must preserve whole-history run boundaries, album grouping, listen numbers, unknown dates and reactions; an early raw-event limit remains unsafe. A shared child/kind relationship access path could be evaluated with actual read/write plans if schema work is separately selected; none was added. Full endpoint serialization and browser resource costs need their own measurements. No cache, index or durable projection is assumed necessary merely from these plans.
