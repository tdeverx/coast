# Private taste publication and card reads

These checks complete the operational drills from step 9 of the taste rework. They used the built localhost preview and its authorised PostgreSQL copy. The recovery fixture ran against a separate newly migrated database containing one synthetic user and title. The existing sealed forecasts are independent of these checks.

## Query count

The native Bun SQL completion counter ran only in the measuring process. Two control statements, including a composed SQL fragment, produced exactly two completions. The test invoked the authenticated candidate-card handler and also measured normal card hydration for the same IDs. Results were identical on three warm runs. Neither SQL text nor parameters were recorded.

| Batch | Known, 24 | Known, 72 | Unseen, 24 | Unseen, 72 |
| --- | ---: | ---: | ---: | ---: |
| Card data | 22 | 44 | 22 | 44 |
| Candidate score response | 7 | 7 | 8 | 8 |
| Both reads together | 29 | 51 | 30 | 52 |

The first batch of 24 known titles and the broader batch with 48 additional known titles each issued eight statements and returned pending while the worker rebuilt independent predictions. All unseen titles were handled immediately. The statement count for scores stayed constant over the two batch sizes. Card hydration and transport through the actual browser were measured separately. [Query-count harness](verification-counts.ts)

## Scrolling while publishing

Signed-in headless Chromium scrolled the actual candidate Library 3,360 pixels and returned to its starting position. Before scrolling, the harness checked PostgreSQL for the background worker’s granted publication lock. It then verified that the worker succeeded and both the copy and running application were still available after publication.

Two rebuilds took 16.06 and 15.19 seconds from worker launch. In each run all 28 scroll samples displayed at least 12 media cards, with five and six completed score responses respectively. There were zero failed score responses and page errors. In the second run 266 animation-frame intervals had a median of 16.7 ms, a 95th percentile of 16.8 ms and a maximum of 66.7 ms. The worker's measured peak resident memory was 427.52 MiB. The measurements cover one account and a desktop viewport under local development load. A delayed badge on a previously known title can still be waiting for independent prediction while the card itself is visible. [Browser harness](verification-scroll.ts)

## Interrupted publication

A database-only fixture places a deterministic barrier on the second medium’s upsert. Once PostgreSQL confirmed that the worker had reached that barrier, an independent connection read the published state. Both previous profiles, their known-root membership and the cached result remained available. The fixture then forcibly terminated only its own worker process and released the barrier. Both profiles and the cache were still identical to the previous snapshot. A fresh worker published a single new epoch for both media, retained correct known-root membership, and invalidated the old cached target. All 15 assertions passed. [Recovery fixture](../../../tests/taste-preview-recovery-db.test.ts)

For reproduction, set the preview owner and database variables as described in the [serving audit](../2026-11-23-taste-v2/serving.md), use the project's pinned Bun, and supply a private browser state file for the signed-in local owner.

```sh
bun --env-file="$private_env" docs/audits/2026-11-23-taste-dislikes/verification-counts.ts
bun --env-file="$private_env" docs/audits/2026-11-23-taste-dislikes/verification-scroll.ts "$private_origin" "$browser_state"
bun scripts/test-database.ts taste-preview-recovery-db.test.ts
```

The last command uses the standard `TEST_DATABASE_URL` runner to create and remove its own disposable database. The fixture checks that database's name before installing the barrier. Run the two copy-based checks sequentially so the query counters can verify that their publication epoch did not change.
