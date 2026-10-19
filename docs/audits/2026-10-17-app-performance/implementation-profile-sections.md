# DATA-13 — prepare only the requested profile section

Activity and favourite refreshes now reuse one shared section reader without preparing page-only backgrounds or featured cards. Complete actual outputs match the original section and full-profile contracts. No UI, settings, policy, schema, dependency, navigation or toast change is included.

[Machine-readable record](implementation-profile-sections.json), [main actual proof](evidence/implementation-profile-sections-actual.json), [other-viewer full-page proof](evidence/implementation-profile-sections-full-audience.json), [actual census](evidence/implementation-profile-sections-census.json).

## Shared owner and consumers

[readProfile](../../../src/lib/server/queries/profile.ts:163) retains the existing shared summary, visibility, counts, filtering, paging, favourite membership/order and media projection. Its internal presentation flag controls the existing featured, fixed-background and latest-activity-background preparation. [profileData](../../../src/lib/server/queries/profile.ts:353) keeps the four-argument full presentation contract. The full profile route continues to use it, including history/favourite route views that still need page presentation.

[profileSectionData](../../../src/lib/server/queries/profile.ts:358) admits only history or favourites and returns the exact existing items/favourites plus page/pages/total shape. History omits this owner's direct profile-settings query and page-only favourite preference validation. Favourites read only order/pin JSON, retain pin/order membership checks and hydrate the requested favourites. Existing feature/privacy request helpers still read their required subject settings; this does **not** eliminate every settings read in a request.

Both [signed-in handlers](../../../src/lib/server/api/profile.server.ts:14) and the existing [guest API branch](../../../src/lib/server/api/index.server.ts:92) use that reader. Guest site-access, owner lookup and visibility checks remain in place. Insight requests retain profileInsightsData. The prior library cancellation signal change in API index is preserved. No compatibility export, endpoint-private cache, extra option framework, listener or background task was added.

## Actual-data verification

The retained [main probe](probes/profile-section-actual.ts) compares the exact [original profile owner](candidates/profile-sections/profile.before.ts.txt) and [original signed-in handler](candidates/profile-sections/api-profile.before.ts.txt) against current source. Both use current source-pinned dependencies and one actual-data snapshot. It compares complete payloads in memory, including card metadata, identity/order, paging, totals and failures; retained evidence contains only aggregate outcomes/counts and source hashes.

A reserved repeatable-read **READ ONLY** transaction explicitly sets and verifies a 30-second statement timeout, 5-second lock timeout and JIT off. Each probe rolls back and closes its connection. No saved catalogue, tracking, profile, policy or normal database row was changed; no fabricated cohort was inserted. The supplemental [full-page audience probe](probes/profile-full-audience-actual.ts) independently uses the same boundary.

| Comparison | Actual result |
| --- | --- |
|All four enabled owners × four signed-in viewers plus guest × history/favourites|40 equal outcomes: 28 successful section DTOs, 12 equal denials; 25 successful responses are nonempty.|
|Saved-owner filter variants|112 complete equal section outcomes across periods, history kinds/repeats, actual-title queries, date bounds, Other genre, first/later/clamped pages, all favourite kinds and all/available scopes. Empty cohorts stay counted as empty coverage.|
|Signed-in activity/favourites/insights HTTP dispatchers|12 complete equal status/body outputs.|
|Full self-profile overview/history/favourites/ratings|16 complete equal DTOs.|
|Full overview/favourites for other signed-in viewers and guests|32 equal outcomes: 20 successful full DTOs and 12 equal denials.|

These comparison categories and the repeated samples overlap; they are not distinct users or distinct saved rows. The full-page checks exercise the domain payload, not the separate route mediaRows/activity fields or browser rendering.

The saved data has four owners, five favourites and one rating; two owners use fixed backgrounds and two activity backgrounds. Three saved favourite-order entries are present. No owner has a configured featured item or pinned favourite, and no owner is guest-visible. Positive public, featured and pinned cases therefore remain actual-data gaps. The focused contracts cover featured/pin behavior separately; they are not presented as actual-data performance evidence. Guest shared-owner/full-page checks prove equal denial, while guest HTTP admission is source-reviewed.

## Observed resource changes

Each row below uses three alternating before/after pairs on the actual self-profile section. ORM statements and serialized ORM result bytes count Drizzle prepared-query execute results, including required history-card work. Direct card IDs count only this profile owner's workCards admissions. Raw BunSQL/config statements, PostgreSQL internal rows, wire bytes, heap/RSS, CPU and browser work are excluded. The byte count serializes returned JavaScript ORM results and is not a database network-transfer measurement.

|Owner ordinal / saved background|Section|ORM statements|Direct workCards IDs|Serialized ORM result bytes|Median complete call ms|
| --- | --- | --- | --- | --- | --- |
|0 / fixed|history|42→22|1→0|352,517→313,924|194.31→126.72|
|0 / fixed|favourites|26→25|4→3|62,200→40,154|111.59→111.36|
|1 / activity|history|24→22|0→0|305,333→291,433|144.77→140.64|
|1 / activity|favourites|25→7|1→0|38,537→280|107.91→36.84|
|2 / activity|history|24→22|0→0|356,404→341,772|130.50→126.73|
|2 / activity|favourites|42→24|2→1|62,154→20,803|156.10→105.24|
|3 / fixed|history|41→22|1→0|303,038→296,603|217.41→151.75|
|3 / fixed|favourites|25→24|1→1|6,698→6,197|114.62→112.31|

Fixed-background history no longer hydrates a discarded background; activity-background history still hydrates its required history cards, while omitting the separate latest-activity lookup. Favourite refreshes omit discarded background work and reduce direct profile settings to order/pin fields. Where the fixed background is already a favourite, card admission can remain unchanged; owner 3 illustrates this. Owner 0's favourite timing is essentially unchanged, despite a smaller projection. These local three-pair timings show the observed cohort, not production latency or statistical guarantees.

The summary still computes its existing visibility/count families, required history mediaViews and required favourite cards. This is a bounded removal of discarded page-presentation work, not a complete profile-query redesign. Existing request-level subject settings reads remain visible in the evidence.

## Controlled contracts and future drift

Eight focused tests passed 53 assertions after final source. The handlers select the narrow section owner; overview/ratings are rejected by the section reader before data access. A controlled owner test verifies history skips preferences/page cards and favourites retain pin/order fields without featured/fixed-background validation. Existing insight/sequence/social/public projection contracts also pass. These tests are separate from the actual saved-cohort proof.

Source hashes were unchanged across both actual probes. Root owns full application gates and the subsequent normal-dev browser acceptance. The provider/jobs agent independently approved the exact profile owner and handler source hashes with no material issue. That source review did not rerun tests or access the database.

Keep the shared full/section owner as presentation grows. Require the same complete actual output/error comparisons before changing admission, and add naturally available guest/featured/pinned cohorts when they exist. Do not replace missing real cohorts with fabricated database performance claims. The exact probes contain local private staging filenames; restage their retained original source files or make a reviewed path-only adaptation for another checkout.

## MIN-03 remains open

Fresh inspection confirms non-personal public catalogue and accessible-library responses still build full workCards before publicWork discards most fields. A plain works-table summary would bypass existing medium presentation behavior: screen metadata overrides, game private title preferences and variant rules, music identity/year, and reading edition/attribution/privacy. This task does not introduce that shortcut.

A future narrow public identity projection should be extracted through the existing medium presentation owners and compared as complete public DTOs across actual catalogue/library kinds, preferences, editions and attribution. Until those shared contracts and actual cohorts are verified, retaining current cards is the concrete lower-risk option. DATA-13's section change does not close MIN-03.

All owned application, test, probe, evidence and report writes are frozen after this publication.
