# Personal match scores below 50

Compare forecasts on the frozen set of 870 direct ratings. Each target's own activity and ratings stay out of its model. Score the 40 titles rated 2½ or below, all 125 five-stars, the other titles rated at least four, and the middle group. A green exit means a five-star forecast moved from at least 80 to below 80. A red forecast is strictly below 50.

## Creative-team corrections

Reuse the [existing returning-team procedure](../2026-11-23-taste-team-transfer/partial-protocol.md). Its narrowest arm requires an identical set of movie directors or show creators, comparable genres, and exclusively negative ratings among eligible titles from that team. For the full-history comparison, refit each contributing work's native forecast after removing the target and the donor's entire franchise. Give each donor franchise equal weight. For the archived comparisons, use the exact original training masks, independent donor errors and forecast values. Validate the older corrections against the archived results before applying public reception.

Compare the personal correction by itself, followed by the existing capped public adjustment, and followed by the fixed direct audience blends. Also test using reception only to decide whether a team penalty should apply. Convert current TMDB votes to Coast's utility scale and shrink towards 50 by multiplying the distance from 50 by votes / (votes + 50). If that public estimate exceeds the original personal prediction, withhold the penalty. All other titles retain the creative-team forecast. This safeguard was proposed after observing the archived failure. Reproducing it on two partitions of the same viewer-title is one example of a rescue.

## Changes inside the personal score

Replay the previously defined [two component removals](../2026-11-23-taste-dislikes/breakdowns-ablation.md) on these exact holdouts. Measure removing a favourable rating intercept when fitted title features lower the rating prediction, suppressing a positive lift from the signed-affinity model, and applying both. Use the frozen display mapping for each refit. This isolates what each existing component contributes to scores.

As a further test, allow the combined removal to create a new red forecast only when independent public evidence agrees. Require the normal forecast to be at least 50, the combined removal to put it below 50, the vote-count-adjusted TMDB utility to be below 50, and the existing neighbouring-title audience check to point down. Otherwise keep the original forecast. Apply that rule alone and alongside the narrow creative-team rule, using the creative-team forecast wherever it already changed the prediction. The cutoffs here are the existing neutral boundaries. Keep the raw component, personal team and public corroboration results separate.

All comparisons are exploratory and offline. Ratings of other works can postdate a target's rating on the full-history test. The audience snapshot represents 23 November 2026. The original earlier-day panels provide a separate sensitivity check for the personal evidence.
