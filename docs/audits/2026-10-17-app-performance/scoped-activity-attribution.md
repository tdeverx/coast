# Scoped Activity — actual baseline attribution, no new fix

The exact movie selected in the normal UI also returns **zero cards and zero events for all four retained clone owners**, but its cloned full feed reads took **2,614–7,556ms**. The primary SQL accounts for almost all that time: **2,614–7,554ms**, leaving **0.6–2.6ms outside the measured primary call**. This identifies a current-clone database bottleneck despite a 52-byte empty result. It does **not** establish the normal browser's request duration or prove why its three-second locator wait expired: the clone's owners/settings/events, timing and cache differ.

The approved [exact exported-owner probe](evidence/scoped-activity-attribution-executed-probe.ts.txt) passed **16 complete owner reads and seven source-shaped EXPLAIN ANALYZE plans**, then rolled back and closed its pool. No repair, application source, schema, index, policy or provider behavior changed. The existing PLAN-02 status is unchanged. [Machine-readable report, source pins and artifact hashes](scoped-activity-attribution.json).

## Existing scopes and complete owner results

The private selected-movie input came from the exact observed normal browser href. The probe verified an existing movie in the clone without retaining its UUID/title. The other inputs are the existing 829-episode season, 23-member collection and show with the most retained episode events. It called the actual exported `activityFeed` for each of four existing screen-enabled, non-disabled owners using the current detail Activity shape: `category=screen`, existing `workId`, `relationship=all`; remaining defaults/cursor semantics are unchanged.

| Actual scope, four owners each | Returned cards | Events | Relationship-only cards | Primary SQL, ms | Complete owner, ms | Serialized output |
| --- | --- | --- | --- | --- | --- | --- |
| Observed normal movie identity | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 each | 2,613.669–7,554.399 | 2,614.284–7,555.552 | 52 bytes each |
| Largest season, 829 episodes | 0 each | 0 each | 0 each | 2,667.225–7,917.380 | 2,667.792–7,918.417 | 52 bytes each |
| Largest collection, 23 members | 0 each | 0 each | 0 each | 2,641.947–7,740.731 | 2,642.267–7,741.773 | 52 bytes each |
| Existing active show | 28 / 19 / 10 / 28 | 27 / 18 / 9 / 27 | 1 each | 2,712.529–7,986.208 | 2,923.829–8,729.061 | 303,075–877,668 bytes |

These are current baseline observations, not before/candidate equivalence or repeated timing samples. Complete exported payloads and ordered identity/group-member/cursor fields were digested in memory; retained evidence has counts/hashes, not row payloads. The active show establishes positive actual grouped-event and relationship-fallback work; the three empty scopes were not fabricated. Empty output is not a reason to skip the relationship-only fallback or assume there is no database work.

Primary elapsed is measured inside the installed Drizzle prepared execute used by the owner. Full elapsed surrounds the actual owner call, including its request-config wrapper and downstream card/status/reaction composition. The historical receipt calls the difference `afterPrimaryOwnerElapsedMs`; it is **the residual outside the measured primary call**, including setup before it and work after it, rather than a strictly post-query phase. Response-size serialization occurs afterward; HTTP/browser and provider latency are not measured.

## What the exact plans show

Seven plans use the **actual primary SQL and parameters captured from those owner calls**, with no reconstructed query or planner rewrite: all four selected-movie owners, plus first-owner season/collection/active-show controls. SQL/parameters stay in private RAM. The retained plans whitelist structural node/relation/index/CTE names and numeric metrics, omitting predicates, private identifiers and payloads.

For selected movie / owner ordinal 0, the primary plan took **7,890.433ms** and returned zero rows. Its root reports **1,341,261 Shared Hit Blocks**, **3,706 Shared Read Blocks**, **2,696 Temp Read Blocks** and **4,412 Temp Written Blocks**. Those root values represent the whole plan; nested counters are not summed. Shared Read Blocks and temporary block counters are PostgreSQL activity, not proven physical disk I/O.

The plan builds `visible_raw` in about **5,924.6ms** despite returning zero rows. It reads **13,902 social events**, carries **12,757 screen rows** through joins and then discards all 12,757 at the late work-scope filter. Its `works` index lookup runs 13,902 times. The relationship fallback side also scans **90,971 tracking-state rows**, about **1,718.8ms** at that node, before the one-row descendant scope rejects them. Broad privacy/feature/enrichment work therefore occurs before the empty work restriction becomes selective.

The shared global edge union is real additional work: **274,922 rows** are materialized, about **113ms** at its aggregate node. It is smaller than the dominant event and tracking subtrees in this observation. The other first-owner plans show the same broad tracking input and expensive visible-event work; the active-show `visible_raw` retains 3,424 events before grouping down to 28 output rows. These node times include their descendants, so they are not independent totals to add together. This attribution supports inspecting exact scope admission first, rather than treating edge inlining as the main cure.

## Guards, provenance and execution boundary

The source was pinned before/after across fourteen existing owner, schema, feature, card and UI-demand files. The database URL had to match both loopback `127.0.0.1:55432`, the approved clone-name format and **the exact pathname in the existing private designated-clone file**. An explicit root lease flag was required. Before workload, a same-database aggregate preflight observed **zero other client backends**. That observation is not an atomic lease or a promise no later client can connect; parent coordination provided exclusivity.

One reserved max-one connection explicitly set and verified `REPEATABLE READ READ ONLY`, 30-second statement / one-second lock budgets, JIT off and `work_mem=4MB`. The same backend was verified after the workload. These local settings make the captured plans comparable; no global database default changed. Fetch was denied, with zero external attempts, and ORM secret projections were rejected. No normal database, credential decryption, provider transport or manufactured data was used.

The [actual aggregate receipt](evidence/scoped-activity-attribution-actual.json) includes progress after each owner/plan and final successful rollback/pool closure. No failed execution occurred. The [reviewed execution plan](candidates/scoped-activity-attribution/plan.executed.json), [fourteen source pins](candidates/scoped-activity-attribution/source-pins.json), immutable [pre-guard preparation](candidates/scoped-activity-attribution/probe.pre-guard-draft.ts.txt), captured source bodies and [pre-execution syntax record](evidence/scoped-activity-attribution-syntax.json) are retained. The [portable probe](probes/scoped-activity-attribution-real.ts) only relocates artifact imports/paths and requires a caller-supplied private selected-identity file; it was not executed as a second pass. No private observed UUID is embedded in it.

## Next bounded option, still private

The evidence supports preparing a materialized **exact existing work-scope event admission** before expensive privacy/enrichment joins. It must preserve the current direct work, episode show/season, season show and direct `contains` membership alternatives; replacing that with arbitrary recursive descendants would change behavior. Artist/group scopes, explicit activity IDs, category/kind/friend/period, visibility, relationship reasons/fallback, deduplication, listen numbering, grouping, ordering and cursor must remain complete.

No early raw-event limit, new cache, durable read model, dependency, schema/index or UI change is selected. A private exact candidate needs source review and full before/candidate exported-output equivalence across available prior 42 cases plus these sixteen scoped cases, deduplicating genuinely identical contexts transparently. New plans must show avoided underlying work, including empty and positive scopes and less-selective cases; lower projected row counts alone are insufficient. That candidate has not executed or been adopted. The separate unsupported-collection insights admission option also remains unexecuted and unadopted under its own review boundary.
