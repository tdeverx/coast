# Archived private taste preview

This records the earlier side-by-side experiment. Cards, item explanations and friend comparisons now use the normal application routes. The current scoring and permission checks are documented in the [personal match serving review](../2026-11-23-personal-match-serving.md).

The preview runs the calibrated movie and show models evaluated in the [paired replay](README.md). On the development copy, the owner's Taste tab shows the new profile. A card's breakdown and the existing Admin → Calculate taste score dialog show the candidate alongside the current personal fit. Opening Library or For You with `?tasteModel=candidate` selects candidate movie and show badges for that visit. The ordinary card policy admits neither medium. The [friend comparison](social.md) has a separate permission check and measurement.

## Publication and serving

Use the project's pinned Bun on a local copy with Coast developer mode, personalisation and screen media enabled. Set `COAST_TASTE_PREVIEW_DATABASE` to the name in the loopback `DATABASE_URL` and `COAST_TASTE_PREVIEW_USER` to the authenticated preview owner's ID. Enable the existing experimental card scores to see badges. Build and serve the app using the same environment as its dedicated worker.

```sh
bun --env-file="$private_env" scripts/taste-preview-worker.ts --rebuild --watch
```

The worker creates its own schema on this database. A background publication reads the owner's full canonical history by medium and separately counts available catalogue descriptions, including titles the owner has never tracked. Both profiles and their known roots change together in one transaction. The worker checks revisions while it runs and rebuilds at least weekly while online. Serving reads the current model for a previously unseen title. For a known movie, season, episode or show, it queues an exact fit that removes the entire canonical work, including its rating, progress, returns and endorsements. While it is being prepared, the owner can still browse and inspect other items.

Visible cards share bounded batches. Their responses, the item dialog and the profile are scoped to the active viewer. A known-title result belongs to a particular profile publication and item-metadata digest. A metadata or history change can therefore invalidate the old score. The worker prioritises open inspections, handles up to eight queued targets per pass, and retains up to 512 completed results. Personal history and saved evidence stay in the local database. The private server suppresses the normal provider and backup scheduler.

## Cost on the copied account

The app benchmark used twelve warm repetitions per cell after one warm-up and alternated the measurement order. Each cell used the same card IDs under all three conditions. Both scoring conditions hydrated the cards and got scores concurrently, as independent UI reads would. Times are median / 95th percentile in milliseconds, measured in the app process including PostgreSQL. Browser startup, networking, images and row selection are outside these figures. Other local validation was active during the run.

| Cards | Card data alone | With current score | With candidate score |
| --- | ---: | ---: | ---: |
| 24 unseen | 4.45 / 6.12 | 11.11 / 14.56 | 8.61 / 16.29 |
| 72 unseen | 12.34 / 26.06 | 20.03 / 56.19 | 19.45 / 25.11 |
| 24 known, result cached | 7.51 / 16.53 | 14.53 / 25.49 | 12.44 / 17.83 |
| 72 known, result cached | 18.42 / 55.44 | 31.18 / 87.39 | 32.18 / 68.45 |

A cold batch of 24 known targets returned “preparing” in 139 ms. Producing their independent predictions took 14.27 seconds in the worker. Requesting a larger batch queued 48 additional fits, which took another 17.02 seconds. No unseen title required a refit. In both 72-card sets every visible score agreed with its detailed calculation. These timings support the preview's batched read path. Known-title previews on a fresh publication can take noticeably longer to appear.

PostgreSQL reported 1,666,927 bytes for the two fitted profiles, 1,566,363 for their source observations and 829,189 for the catalogue counts. Those are stored column sizes for one account, before table/index overhead and the bounded result cache.

We also read all 7,356 unseen forecast titles through the current serving code and compared them with the sealed research ledger. All 3,128 show results agreed. Of 4,228 films, 4,175 agreed, 47 differed by one point and six differed by two. Every decision to withhold a score agreed. Between snapshots one film's viewing and repeat evidence had changed, and one forecast target's metadata differed. Restoring those frozen inputs in memory reproduced all 4,228 film results exactly.

```sh
bun --env-file="$private_env" scripts/taste-preview-benchmark.ts 12
```

## Browser checks

Signed-in Chromium opened the owner's Taste tab, switched to Tags, opened an actual Library card's admin inspection, and clicked a candidate badge. The badge and dialog both showed 80% for that title. The phone viewport measured 390 pixels wide with a document width of 390. The desktop and phone run reported no page or console errors. The [friend check](social.md) covered profile-to-profile comparison, segment changes and pagination. These checks used the compiled app with a real-data copy.

The production build, type checks, UI inventory and source-style checks passed. Five personal and social PostgreSQL suites passed all 45 tests. The full unit run passed 1,333 checks and reported three historical checks for the already-edited roadmap. A separate database run identified three failures tied to the earlier Trakt change that preserves a show's Dropped status when episodes are marked watched. Restoring that single line in an isolated checkout made all 14 domain tests pass. The working branch retains the earlier tracking behaviour.
