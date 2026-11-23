# Does the same person's work on films and shows predict either medium?

## Test fixed before scoring

Allow a rated film directed by a television creator, or a show created by a film director, to inform an existing match in the other medium. Test exact lead sets first. A wider comparison allows at least half of the union of both lead sets to be shared. Both require stable person IDs and genre overlap of at least half. Collapse film Action and Adventure into the show's combined Action & Adventure category, and Science Fiction and Fantasy into the show's Sci-Fi & Fantasy category. Other genre IDs remain distinct.

Use the original 32 movie/show panels. In structural tests, withhold the corresponding fold and keep the original rating budget independently in each medium. A fully masked profile therefore supplies no ratings in either. On rating dates, admit only opinions from preceding UTC days. A cross-format adjustment additionally requires the other work's own held-out personal prediction. Native inner predictions and earlier chronological forecasts supply these residuals. Ratings without a prior independent prediction can still veto a transfer. Do not use audience or peer data.

Check both directions separately. A negative adjustment requires all eligible earlier opinions from that creative team to be 2½ stars or below. A positive adjustment requires all of them to be at least 4½ stars. Across both media, a known conflicting opinion vetoes that direction, including an opinion on a different genre. Exclude stored shared franchises, collections, and titles with an identical normalised name. The transferred correction is the mean prediction error for the matching cross-format work(s), weighting each donor franchise once. Report opportunities and affected outcomes, including errors, never counting the original four repeatedly across splits as a new success. Credits and genre descriptions reflect the current catalogue.

## Results

On whole titles, five films and five shows had an available similar-genre work directed or created by the identical team in the other medium. Zero of the viewer’s 40 dislikes had that comparison. Allowing half-overlapping leads raised coverage to seven films and seven shows. That wider variant boosted one already-green 4½-star show from 86 to 96. It did not recover a missed five-star match. The earlier-day checks made no changes. In two sparse movie panels, the otherwise strict rule assigned 100 to a 3½-star film from an already-green baseline. A creator's job and the available evidence both change across media. This transfer adds little coverage in this account.

[Reproducible comparison](cross-format.py) · [32-panel results](cross-format-results.json)
