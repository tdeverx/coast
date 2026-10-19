# MIN-07: batch planned-party creation friendship admission

Planned-party creation now checks a friend list through one ordered query at each of its **two separate admission phases**. The new shared [requireFriends owner](../../../src/lib/social/service.server.ts#L62) also supplies the existing single-target `requireFriend` calls. The [creation service](../../../src/lib/experiments/planning.server.ts#L12) retains its raw input limit, first-occurrence string Set, fresh transaction check, policy/account ordering and plan/outbox fields. [Scope, current pins and evidence](implementation-planning-admission.json).

All **16 actual singleton outcomes and 36 actual-row list outcomes matched**. Existing accepted-friend lists of 3/2/2/3 took 3/2/2/3 queries before and one each after; empty lists remain zero queries and singletons remain one. This is a query-admission reduction, not a measured latency, CPU, RSS, WAL or live party gain.

MIN-07 is **partial**. All four actual accounts currently have Planning off, and no admitted actual plan creation was executed. Reminder notification batching remains unadopted because it would change partial-delivery and settings-observation semantics. No normal database, schema, dependency, root `experiments/comic-lab` or approved UI was changed.

## Shared owner and preserved behavior

`requireFriends` receives the caller's ordered IDs and an optional existing native transaction. It unnests a UUID array with ordinality, applies the original accepted-friendship / existing-not-disabled-recipient / both-social-features predicate, and selects the first missing admission in caller order. The same generic `403`, `request_failed` code and message remain. No names or failing IDs are exposed. Existing single-target calls delegate a one-element list to this predicate.

Creation still validates the **raw** maximum20 UUID entries before deduplication. Twenty-one copies of one friend remain invalid. It computes the same case-sensitive JavaScript string Set formerly computed at insertion: first occurrence and raw uppercase/lowercase spelling remain, with no normalization. It uses that list once before opening the transaction and once after `requireFeature(..., tx)` inside the existing transaction. The second helper receives that exact transaction rather than acquiring a pool connection. Actor policy/feature checks still precede the account advisory lock,100-plan cap and atomic plan/reminder-outbox insertion. Work/category/playable-kind checks and exact error order are retained.

The former transaction query did not spell out its separate users join; the predicate was already implied by `coast_feature_enabled`'s existing/not-disabled subject clause. The actual clone's function body was compared to the reviewed [0058 SQL](../../../drizzle/0058_feature_controls.sql#L12), rather than assuming schema parity. Normalized bodies matched; language SQL, STABLE volatility, non-security-definer and absence of per-function session overrides were checked. Actual definition/body hashes and the source migration hash are retained.

**Observation timing changes within each phase:** one statement snapshot replaces serial per-friend snapshots, including redundant duplicate rechecks. Preflight and a separate fresh transaction admission remain. Equal outcomes on stable state do not prove every concurrent read schedule identical, and friendship admission remains a read check rather than a new commit-time friendship fence.

Other shared consumers retain the one-target interface: recommendation preflight, friend insights, synced-party authorization/invitation checks and each planning-reminder friend check. The `remindPlan` body is byte-identical; its `requireFriend` dependency now delegates to the shared one-target query. Its individual notification writes, per-recipient preference reads, catch/continue behavior and error boundaries remain. This does not establish complete live acceptance for every caller.

## Retained actual cohorts

The [census](evidence/implementation-planning-admission-census.json) used a reserved repeatable-read READ ONLY transaction with verified10s statement/1s lock budgets, then rolled back and closed. It created no plan, friend, room, setting, notice or job.

| Actual retained state | Observation |
| --- | ---: |
| Owners |4; social and Parties on, Planning off |
| Accepted / pending friendships |5 /1 |
| Admitted friends by owner ordinal |3 /2 /2 /3 |
| Plans |1 scheduled, already past; party=false,0friends |
| Future scheduled plans |0 |
| Planning notices |0 of518 total notices |
| Planning reminder jobs |1 cancelled |
| Synced rooms |39, all ended |
| Synced participants |43 not joined;0 recent heartbeats |
| Synced-invite notices |5 |

Each owner has an actual saved policy-eligible screen work. That does not override Planning being off. The past empty non-party plan is not a positive future-party operation. Ended rooms and invitation records do not establish active client or planned-party delivery acceptance. No feature was enabled to manufacture a passing mutation cohort.

## Actual helper proof and supplementary command controls

The [private helper proof](evidence/implementation-planning-admission-actual.json) executed the exact original and proposed shared owner against existing actual friendship/user/feature rows in one READ ONLY snapshot, again with verified10s/1s budgets. It retained only ordinal/count/outcome information and function/source hashes. No provider fetch or database write occurred; the transaction rolled back and the pool closed. Production retained its original source throughout this proof.

All16 singleton comparisons matched:10 accepted and6 rejected, including self and actual nonfriend cases. Both versions used one query. All36 list comparisons matched their allowed/denied outcome, status/code/message and first invalid identity order. They cover the complete admitted friend lists, actual user lists in both directions, empty inputs, invalid entries at different positions and controlled duplicate/case input boundaries over those same existing rows. No private row IDs or payloads were retained.

The raw20 repeated-input case measured20 admission queries versus one over **one existing friend**. It is a controlled legal-input boundary, not a naturally observed20-distinct-friend population, plan creation or scaling benchmark. The observed reduction for the actual complete admitted friend lists is2–3 queries to one per phase. The SQL still evaluates the necessary friendship/policy predicates; fewer round trips do not establish lower PostgreSQL CPU or total resource use.

Separately, [eight tableless command schedules](evidence/implementation-planning-admission-command-controls.json) compared original and candidate creation function bodies. They matched complete command outcomes and modeled stored plan/outbox fields for ordered deduplication, uppercase/lowercase string Set behavior, empty friends, raw21 rejection, first-invalid order, friendship withdrawal between phases, party-feature withdrawal and the100-plan cap. Their counters model command orchestration through stubs; they are not PostgreSQL measurements or actual Planning-enabled creation acceptance.

The maintained [regression](../../../tests/planning-admission.test.ts) loads **current production source** in an isolated [worker](../../../tests/fixtures/planning-admission.ts). It asserts those eight expected protocols, stored values, source-independent transaction ownership and ordering without depending on the historical audit baseline. The focused run passed1 test /5 outer assertions; internal controls throw on any of their required invariants. It opens no database or provider connection. Root owns combined gates and any normal-browser validation.

## Reminder contract and maintenance

Directly replacing the reminder loop with `notifyMany` would change behavior. Today the owner notice and each friend notice are separate statements; an earlier committed prefix remains when a later notification fails. Friendship query errors are caught for one friend and iteration continues, while notification write errors propagate. Configuration/preferences are reread at each recipient. A single multi-row notification statement changes chunk failure atomicity and snapshot timing. These options remain in [the shared notification plan](next-notification-batch.md); this change selects neither and adds no caller-private cache or alternate writer.

Independent read-only review approved the exact shared predicate and creation changes while explicitly identifying the per-phase snapshot difference. The exact verified candidate hashes were adopted after the actual helper proof passed; no second actual helper run is inferred from adoption. The reminder-body equality and52 helper outcomes are narrower evidence than live delivery.

The [captured social baseline](candidates/planning-admission/social.before.ts.txt), [social candidate](candidates/planning-admission/social.candidate.ts.txt), [planning baseline](candidates/planning-admission/planning.before.ts.txt), [planning candidate](candidates/planning-admission/planning.candidate.ts.txt), exact [census](probes/planning-friends-census.ts), [pre-adoption helper probe](probes/planning-friend-candidate-actual.ts) and [private command controls](probes/planning-command-candidate-controls.ts) retain source provenance. Historical probes intentionally retain their original private-file/pin requirements. The [maintained actual replay](probes/planning-friend-real.ts) instead reads the captured baseline/current candidate and uses a relocatable root. It was syntax checked without another clone run; the maintained project test is the executed current-source command regression.

A future natural Planning-enabled cohort is still needed for full actual creation/outbox and reminder acceptance, including rollback or visible operation with preserved notification identities. Concurrent withdrawal, disabled/social-off recipients, real20-distinct-friend input, live API authorization and browser/resource observations remain gaps. Tests must continue to distinguish those absent cohorts from tableless or controlled-input coverage. Source and actual function pins fail closed on drift rather than silently assuming equivalent policy.

Root combined acceptance: [787passed/708guardedskip/0fail, clean check/build/inventories](evidence/implementation-verification.json) and the [frozen signed-in normal5173 trial](evidence/implementation-shared-admission-normal.json) passed. Actual Continue/Next, friend taste/overlap, Library/music detail/settled Back, Admin and30Tasks rendered without new warnings/errors or source drift. No live recommendation job or admitted Planning creation is inferred.
