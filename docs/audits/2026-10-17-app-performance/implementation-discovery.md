# Screen discovery admission implementation

DATA-08 is implemented at the existing catalogue discovery owner. `discoverMedia(userId, section?)` selects the named provider bucket before calling its fetcher or ingesting metadata. The shared screen query forwards its validated section. Calls that omit the section retain both buckets. The production change is confined to `src/lib/catalogue/service.server.ts` and `src/lib/server/queries/discovery.ts`.

## Shared owner and consumers

Every authenticated `GET /api/v1/discover?surface=watch&section=…` now uses the selected bucket. This covers the common discovery Shelf source in lazy rows, row-to-section detail grids, returning from another surface to Watch, retries and content-revision reloads. Both named sections share the same ingestion and presentation owners. A failure in an unrequested bucket is consequently neither admitted nor reported as a failure of the selected bucket.

The `/discover` page loader remains an intentional combined consumer, including guests and direct Watch section SSR. Its hero/fallback, two-bucket seed and item ordering remain unchanged. For You only links to `/discover`; it has no independent screen discovery feed. Reading, game and music discovery keep their separate owners. This change adds no UI, cache, dependency, schema, index or alternate persistence path.

TMDB retains priority over Seerr. Seerr still has no recent feed: a named recent request does not fetch its trending feed. The existing four-ingestion concurrency bound applies to one selected bucket; the combined path retains four per bucket. Empty combined results still use the existing bounded catalogue fallback. The named screen query still presents explicit bucket IDs and does not substitute that fallback for an empty row.

## Actual-data verification

The signed-in normal-development browser captured two actual rendered 20-card shelves and their exact identities/order, with no new console errors in that capture. All 40 positions matched the actual clone's existing media, `en-US`/`GB` retained TMDB snapshots and external identities: 35 distinct titles and five shared titles. Capture and raw per-item content stay private under `/private/tmp`; committed evidence contains counts, booleans, digests and production source hashes.

`probes/real-discovery-match.ts` performs that bounded read-only match. `probes/real-discovery-admission.ts` then runs the audited catalogue owner and final applied owner against those actual retained normalized snapshots, using unchanged real `ingestMetadata` and existing users/media. Each individual metadata transaction finishes its real work and then rolls back, preserving the original pool/concurrency behavior. The final canonical `discoveryContent` and real `mediaViews` also return both exact captured 20-card sequences. No provider calls, credentials, policy/settings edits or invented provider content are involved.

The final portable probe passed **31 checks across 15 phases**. Snapshot tuple/content, work-feature and identity digests plus user/media counts matched their before-state after all rollbacks. All three production source hashes remained stable during the run.

| Controlled retained-snapshot request | Metadata transactions | ORM statements | Snapshot UPDATEs | Maximum active ingestion transactions |
| --- | ---: | ---: | ---: | ---: |
| Before: named Trending | 40 | 403 | 40 | 8 |
| Before: named Recent | 40 | 403 | 40 | 8 |
| Final: named Trending | 20 | 211 | 20 | 4 |
| Final: named Recent | 20 | 193 | 20 | 4 |
| Final: combined | 40 | 403 | 40 | 8 |

Canonical card presentation adds 16 ORM SELECTs to each final named case, producing 227 and 209 ORM statements respectively. Counts exclude the probe's timeout statements and constructor transport replacement; they are not a universal endpoint SQL census. Five overlapping titles still participate in their requested bucket; only titles exclusive to the unrequested bucket are excluded. Combined identities, order and deduplication match the audited owner.

These are **controlled adapter admissions and actual rollback DB work**, not measured natural wire savings. The retained snapshots may contain richer fields than the original discovery endpoint payloads. Original feed-response bodies are not retained, and snapshots alone cannot reconstruct historical feed membership or order; the browser capture supplies that membership independently. Empty/failure/no-provider/Seerr-recent controls verify branches, without claiming a real provider outage or actual Seerr feed acceptance. Elapsed samples remain descriptive, with no cold/warm speedup or production percentile claim.

## Focused regressions and drift

```sh
.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/discovery-admission.test.ts tests/ui-discovery-source.test.ts
```

**12 tests passed, 58 assertions.** Eight new admission/query regressions use empty provider results to protect named selection, combined behavior, unrelated/requested failures, feature withdrawal, no-provider and Seerr-recent behavior. They introduce no provider content. Existing Shelf regressions protect revision invalidation, retry, medium switching, cancellation and lazy demand. The named-admission regression fails against the audited owner because it invokes the extra recent feed.

For a future actual-data replay, recapture the real combined shelves through the authorized browser, run the read-only match on the approved private clone, then run the admission probe through the private clone runner. Keep credentials and captured identities/content out of committed evidence; preserve explicit statement/lock budgets in individual mutation transactions. If exact retained identities do not match, record the gap instead of fabricating feed content. Root-owned common check/build and post-change normal-dev acceptance are separate evidence.

The separate malformed artwork-cache recovery candidate remains source-only and unimplemented in `implementation-artwork.md`; this discovery change does not select a cache eviction or retention policy.
