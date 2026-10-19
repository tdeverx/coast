# Screen detail card reuse

The repeated-card slice of `DATA-04` is implemented in the existing `detailsData` owner. One invocation now reuses already-observed base cards across parents, child/season cards, related cards and collection sequences. Complete memberships and output remain intact. The 829-episode season still returns its full approximately 1.49 MB DTO; child paging, response growth and optional enrichment repeating the whole composition remain open concerns.

The exact private candidate was applied only after twelve complete actual-data output comparisons passed. No dependency, schema, UI, paging, retention or provider policy changed. Normal/deployed databases were untouched. [Machine-readable report](implementation-detail-hydration.json).

## Shared ownership and observation semantics

`src/lib/server/queries/media.ts:728` seeds a local map with the already-read root card. The parent and child IDs share one bounded `mediaViewsForIds` admission, related IDs admit only unseen identities, and all already-expanded collection sequences share another admission. Missing identities are remembered only until that invocation ends. Existing batching at sixty, first-request order and omitted-missing behavior remain in the same canonical card reader.

Parent collection selection, complete canonical `sequenceEntries` expansions, explicit occurrence order and `applySequenceEntry` are preserved. Each sequence occurrence receives a fresh outer object, sequence context and tracking-progress object; shared base/nested DTO values are treated as immutable. The source review found no mutation of these detail cards in their current consumers. `ScreenActions` mutates a separate actions-response DTO rather than the detail input. The independent `nextPlayable` owner remains in its original `Promise.all` phase and can still hydrate its selected card separately; no next-selection semantics or cache was introduced.

The map deliberately returns the **earliest observed base-card or missing result within this one composition**. A subsequent `detailsData` call starts fresh, including each optional enrichment reread. Production does not gain a single database snapshot, cross-request cache, transaction lock or concurrent permission/graph-revocation linearization. Exact actual comparisons used a private read-only repeatable-read snapshot to make the before/current comparison meaningful; that test setting was not added to production.

All existing screen consumers use the same owner: the full `/media/[id]` page and optional enrichment through `loadMediaDetails`; the canonical media API initial/enhanced detail reads; and `workDetailData` screen composition used by generic work/detail entry points. `MediaDetails`, `MediaDetailRows`, `media/Details` and the detail panel retain their existing complete DTOs. The public guest detail owner is separate and unchanged.

## Actual catalogue proof

[Actual census](evidence/implementation-detail-hydration-census.json) found 413 collections and 1,348 direct collection edges, with no actual multiple-parent, nested, repeated-path or missing-child positive cohort. No overlap was manufactured. Natural reuse exists within the largest collection: its same twenty-three cards appear in related cards and its member sequence. A member detail also rereads its already-hydrated root within its parent sequence. The largest season rereads its root season among child/season cards.

The historical census field `max_direct_parent_collections: 0` was calculated only over groups having more than one parent; it is **not** the maximum among all child groups. The selected actual member has one parent collection. Its preliminary `union*` counters also exclude separately-read tracking parents; use the complete owner instrumentation below for full admission counts.

[Actual before/candidate receipt](evidence/implementation-detail-hydration-actual.json): four existing enabled screen owners × three actual cohorts = **twelve complete DTO pairs**, all equal with unchanged ordered parent/child/related/sequence/next identities and exact unique admitted card IDs. No array sorting, DTO subset or field normalization weakened equality. Every season retained 829 episodes; every collection retained twenty-three related cards and twenty-three member occurrences; every selected member retained its complete twenty-three-occurrence parent sequence. Availability, history, cast, saved metadata, tracking and viewer-specific fields were included in the full equality comparison.

| Actual cohort, for each of four owners | Card hydration calls | Admitted card IDs | ORM statements | ORM driver rows |
| --- | ---: | ---: | ---: | ---: |
| 829-episode season | 16 → 15 | 832 → 831 | 264 → 248 | 5,910 → 5,902 |
| 23-member collection | 4 → 3 | 48 → 25 | 78 → 62 | 326–328 → 207–208 |
| Member with that parent collection | 3 → 3 | 25 → 24 | 60 → 60 | 185–186 → 180–181 |

The collection's remaining repeated admission belongs to independent `nextPlayable`. One fewer requested identity does not always remove a batch or ORM statement, as the member control demonstrates. ORM counts include correctly instrumented Drizzle session and session-options logging; driver rows count returned rows, not internal PostgreSQL scan work. Raw configuration SQL and PostgreSQL internal work are excluded. No time, CPU, heap, DOM, provider-latency or response-byte reduction is claimed.

The probe explicitly verified `READ ONLY`, repeatable read, a thirty-second statement timeout and five-second lock timeout on its reserved connection. All ORM statements observed were reads, forbidden external transport attempts were zero, all ten pinned source dependencies stayed unchanged, the transaction rolled back and the pool closed. Actual IDs, titles, SQL parameters, DTO payloads and credentials were kept out of retained output; only aggregate counts and equality digests remain.

## Regression and reproduction

[Focused verification](evidence/implementation-detail-hydration-tests.txt): **twelve tests passed / zero failed / 84 assertions** across the new whole-owner regression, existing detail enrichment and existing read-projection suites. The new test compiles the complete `detailsData` implementation at existing named I/O boundaries. It verifies two parent sequences sharing/repeating a card, exact occurrence order/context, fresh occurrence and tracking objects, unchanged immutable base cards, missing-ID admission once, independent next selection, and a new invocation observing changed and formerly missing cards. These controlled cases protect correctness; they are not fabricated actual-data performance cohorts. Existing database detail/permission/hierarchy suites remain separate guarded tests and were not run on the actual clone by this owner.

The provider/jobs agent independently reviewed the exact candidate before adoption; root independently reviewed the adopted owner and controlled regression. Neither found a material blocker. This owner did not run common check/build or browser acceptance; root coordinates those after concurrent sources stabilize.

The [executed private probe text](evidence/implementation-detail-hydration-executed-probe.ts.txt) preserves the exact before-adoption guard and source paths used for the historical receipt. The [portable guarded replay](probes/detail-hydration-real.ts) instead resolves repository paths and pins the now-adopted source against the [retained baseline](candidates/detail-hydration/media.before.ts.txt). Its only execution-boundary changes are path/production-source guards and the corresponding receipt field; it has been syntax-checked, not rerun against the database. The [portable census](probes/detail-hydration-census.ts) is similarly path-adapted. Run either only through a separately authorized designated-clone environment; do not point it at a normal installation. Preserve a new receipt after any source or data change rather than repointing the historical evidence.

Broader acceptance still needs meaningful actual cohorts for nested/multiple-parent/repeated/missing membership, provider enrichment timing and concurrent changes, plus rendered long-season/detail interaction. Complete membership and per-response resource size remain open. A later paging/windowing policy must preserve complete sequence semantics deliberately; it is outside this narrow reuse change.

The root combined type gate caught one test-only inferred UUID Map-key type. An explicit string-key annotation fixed it; the [failed check](evidence/implementation-20261018-read-demand-check-preflight.log) remains retained, focused12/84 and final common785/706guardedskip/0fail/check0/0 passed. Application candidate bytes and actual proof are unchanged.
