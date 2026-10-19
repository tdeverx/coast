# PLAN-08: admit profile genre fallback only when needed

The shared profile genre query now skips metadata-snapshot lookup when an explicit override or nonempty media genre array already supplies its result. The change is one predicate in the existing [genreRows owner](../../../src/lib/server/queries/profile.ts#L47), with no cache, dependency, schema, UI or privacy change. [Machine-readable scope and evidence](implementation-profile-genres.json) retain exact source pins. This repairs one PLAN-08 slice; repeated watch-history aggregates and the other measurement leads remain.

## Behavior and shared consumers

The predicate `o.genres is null and nullif(m.genres,'{}') is null` sits **inside** the existing lateral snapshot query. The outer `coalesce(o.genres,nullif(m.genres,'{}'),snapshot.genres,'{}'::text[])`, distinct media/genre pairs, newest nonempty snapshot order/limit and all history predicates remain unchanged. An explicit empty override is a value and still suppresses media/snapshot genres. A null override with null/empty media genres still admits the newest nonempty snapshot, ignoring newer empty snapshots. No metadata result is cached between calls.

This same owner supplies profile activity genre breakdowns and named-genre/Other history filtering in full pages, history sections and insight refreshes. Genre ranking, six+Other totals and filter strings remain at their existing owners; no displayed values are capped or replaced. Period dates, unknown-date/rewatch handling, ratings, seasons, cards, privacy/features and earlier DATA-13 projection changes stay intact.

## Actual source census

The [initial census](evidence/implementation-profile-genres-census.json) used exact recorded-watch membership, four existing enabled owners and the actual private clone. It ran a reserved repeatable-read READ ONLY transaction with verified10s statement/1s lock timeouts, rolled back and closed. It performed no provider/key/credential lookup, write, fixture setup or timing trial.

| Existing owner ordinal | Distinct history media | Genre roots | Media-priority genre roots | True snapshot fallback roots | Distinct media whose snapshot probe can be skipped |
| --- | ---: | ---: | ---: | ---: | ---: |
|0 |53 |17 |14 |3 |40 |
|1 |6,703 |442 |439 |3 |6,539 |
|2 |1,313 |102 |100 |2 |1,279 |
|3 |10,779 |775 |770 |5 |10,643 |

There are **zero metadata override rows**, including zero empty overrides. Those branches must not be described as actual-data passes. No missing-fallback positive cohort appeared among these owned roots. The probe did not fabricate one.

## Complete outputs and actual read work

Before changing production source, the [candidate probe](evidence/implementation-profile-genres-actual.json) compared full baseline and candidate results in one reserved READ ONLY snapshot, with the same explicit10s/1s budgets. It loaded exact production source bodies, relocated imports to the existing canonical dependencies and exposed private SQL helpers only inside the probe. It made no database or provider change.

All **72 comparisons matched**:12 complete genre-row outputs (four owners × all/month/year),36 complete activity outcomes (self/other/guest across those periods), and24 full filtered-profile outcomes using each owner's actual top genre and Other filter. Activity included24 allowed results and12 privacy denials; history included16 allowed results and8 denials. Positive other-viewer reads were exercised as well as self reads. Full fields, order and denied errors were compared in memory and discarded. Only aggregate results and whitelisted plan fields were retained.

For the largest actual owner, sanitized plans confirmed an inner scan reduction rather than merely discarding already-read values:

| One full all-time genre query | Before | Candidate |
| --- | ---: | ---: |
| metadata_snapshots index-scan loops |10,779 |136 |
| That scan's shared buffer hits |53,894 |680 |
| Whole-plan shared buffer hits |103,029 |49,911 |
| EXPLAIN execution sample |110.177ms |138.593ms |
| Four alternating warm query pairs, median |100.065ms |66.951ms |

The136 remaining probes correspond to distinct watched media under the five roots that still need snapshot fallback; per-media genre counting remains unchanged. All target scan blocks were cache hits. These are local read-work and warm-query observations, not physical I/O, endpoint, browser, CPU, RSS or WAL measurements. The slower candidate EXPLAIN sample is retained: the evidence supports less read work, without promising universal elapsed speedup. Outer SQL statement count and the recorded-watch/window work remain.

The production source stayed unchanged during candidate verification, then adopted that exact verified candidate hash. Both transactions rolled back and all pools closed. No normal database/provider access, schema work or fabricated catalogue was used.

## Regression and maintenance boundaries

The existing projection tests pass8 tests/53 assertions. The new [guarded database regression](../../../tests/profile-genre-projection-db.test.ts) covers explicit empty/nonempty overrides, null override and media precedence, latest nonempty fallback despite newer empty snapshots, missing fallback and fresh subsequent snapshot/media changes. It is1 guarded skip here, not an executed override pass. Its authored setup explicitly rejects the actual-data clone; run it only through the existing disposable correctness-database owner. The72 actual comparisons and inner scan plans are the primary verification.

The [exact pre-adoption probe](probes/profile-genres-candidate-actual.ts), [exact census](probes/profile-genres-census.ts) and [captured baseline](candidates/profile-genres/profile.before.ts.txt) remain historical executable source. The pre-adoption probe intentionally requires its old production pin and cannot be rerun unchanged after adoption. The [maintained current-source probe](probes/profile-genres-real.ts) instead reads the pinned baseline artifact and current candidate, failing on source drift. Its changes are path/pin admission only; publication syntax-checked it without another clone run. Independent read-only review approved the exact source diff with no material issue; it performed no test/DB rerun. Root owns common gates and any normal-browser acceptance.

PLAN-03 and PLAN-05 received source review but no implementation. Taste freshness expressions are user-dependent, and global scalar subqueries may already execute as InitPlans; no JS freshness hoist is justified without plans. The separate duplicate music-profile build has zero actual favourite-artist rows. Feed definitions already use one census per visit; no new interest/adjacency attribution or cache was established. These options remain visible without inventing populations or introducing caching.

## Root combined gates and normal acceptance

The [source-frozen normal dev (localhost:5173) trial](evidence/implementation-summary-avatar-normal.json) passed the existing signed-in chooser flow: open Profile editor, select the connected avatar source, cancel, reopen with the same saved preview, then cancel again. No profile Save was submitted. The actual profile genre heading rendered, settled Library showed 120 media links / 29 completed private-or-inline images, and Tasks ended with 30 rows, no open dialog and no new warning/error. The first Library sample still showed the outgoing profile and is explicitly retained as an invalid sample; acceptance waits for the Library heading and actual cards. No provider/decode/cancellation timing or bearer-token HTTP acceptance is inferred from these UI steps. Source hashes remained unchanged.

Common gates: **784 passed, 704 guarded skips, 0 failures, 33,604 assertions across 1,488 tests / 269 files**; Svelte check 0 errors / 0 warnings, production build, source/UI inventories and style checks passed. Guarded skips are not acceptance; the new genre override fixture was not run on the actual clone. [Library screenshot (private verification image)](publication.md#private-verification-images).
