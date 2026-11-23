# Personal taste matches on cards

Cards, the match dialog and the admin inspector ask the same question about the signed-in viewer and the selected catalogue work. A collection takes a sample of its members and uses those item results. The per-medium model and donor reference come from the background taste job. The request resolves the permitted catalogue roots in one batch and applies the model to their current features. Card batches accept up to 72 IDs. The underlying recommendation shortlist remains a separate consumer of the previous scoring reference.

## What the selected rules reproduced

The [catalogue comparison](2026-11-23-taste-raw-start/catalogue-preview.md) covers 11,831 movie and show roots from one copied database. The independent fit had enough evidence to score 11,707, including 10,377 previously unseen works. With matching synopsis vectors, the TypeScript evaluator reproduced all 11,707 reference percentages and rule choices, including all 870 earlier whole-title holdouts. The four otherwise different results came from a story comparison that requires a compatible vector. Without those vectors the evaluator reproduced 11,703 outcomes, including the original eight detected dislikes. The [display experiment](2026-11-23-taste-raw-start/soft-calibration.md) records why the existing calibration was kept.

The 870-title benchmark fitted each held-out prediction with that title's observations removed. The normal background job publishes a full model and grouped folds. Requests for tracked works use a fold whose training data excludes that work and its family. Unseen titles use the full personal model, with independent evidence when they belong to a known family. Whole-fold and whole-title fits use different amounts of evidence. Numerical equality in the portable scorer comparison does not establish that every production fold reproduces an exact whole-title refit.

An independent pass then ran the **ordinary production scorer** against the same copy. All eight of the 40 original dislikes that crossed below 50 stayed there. None of the 610 four- and five-star works fell below 50. Across the 870 rated holdouts, the absolute change from the exact whole-title replay had a median of one point and a mean of 1.383 points. Among 10,377 previously unseen titles, 10,281 retained the exact displayed percentage, with a mean absolute change of 0.0103 points. Ten unseen titles scored below 50. Each figure refers to this account and this catalogue.

## Serving boundaries

The lookup keys include the viewer, medium and fold. A warm read verifies the account, effective access, publication version and timestamp. Supplying the same IDs again, opening a card on another user's profile, or calling the inspector cannot change the viewer used for the score. Cold inputs can return a pending result or insufficient evidence. Missing synopsis vectors disable the dependent story comparison. Evidence from a different encoder or an earlier version of the synopsis is discarded.

Disposable PostgreSQL checks exercised ordinary and admin reads, expired permissions, source revisions, private cache isolation, grouped exclusions and job cancellation. The inspector and card showed the current result after the test deliberately corrupted a superseded recommendation-cache score. The private offline replay fixture still checks exact-title refits and metadata invalidation. It has no public preview endpoint.

In a 24-card batch on the development copy, the first actual viewport request took 622 ms and six warm requests had a median of 49.5 ms. Unseen-only batches had a warm median of 41.1 ms. The most demanding batch exercised ten held-out folds and took 44.2 ms warm after reference packing, compared with 318.1 ms before. The full [serving comparison](2026-11-23-taste-raw-start/catalogue-preview.md) reports the sample and limits.

The earlier [candidate receipt](2026-11-23-taste-v2-source-refresh.json) remains the record of a private comparison at that point in development. It includes earlier accuracy and resource measurements. No new dependency or external request forms part of an interactive score read.
