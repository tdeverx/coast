# Does the viewer repeatedly dislike one studio's take on a genre?

The previous explanations contained personal examples for and against a production studio on similar adult cartoon shows. This follow-up was chosen after inspecting those explanations. The policy below was fixed before running it on the frozen holdouts. It uses the viewer's direct ratings and stable catalogue descriptors. Audience opinion and target interactions supply no inputs.

For each credited production studio, find the viewer’s other rated titles from that studio whose genre sets have Jaccard similarity of at least one half to the target. Hold the target’s entire franchise out of both sides of this comparison. Within every other franchise, pick the exemplar closest by genre, then tag overlap, then stable title ID, without seeing the rating. Count one exemplar per independent family.

For each exemplar, find up to three similarly described works from separate families outside that studio that the viewer also rated. Apply the same similarity cutoff, ordering and franchise rule. Controls must have a known production studio. Require at least three distinct control families overall. An exemplar supplies a negative comparison when the viewer rated it at least one star below the average of its controls. Test two forms:

1. **Studio context alone.** Require at least two disliked exemplar families, no liked exemplar (four stars or higher) and at least 85% posterior probability of a majority of actual dislikes under the Beta(1,1) prior used in the earlier exact-evidence test.
2. **Studio context plus personal comparisons.** Apply the first rule and additionally require an 85% posterior probability of a majority of negative comparisons across those exemplars. An exemplar with no matching controls supplies no negative comparison.

For either form, withhold the reduction if any of the title’s other studios has at least two matched liked families and a strict majority of liked exemplar ratings. If several studios qualify, use their least negative forecast. Estimate the resulting fit directly from the average star utility of the qualifying families plus one neutral observation. Lower the original score only if the rounded estimate is below 50. This deliberately permits a genuine dislike prediction.

Use the frozen grader’s work, franchise, alternate franchise, earlier rating days and sparse/zero-rating folds. Hide the target, its labels and all co-held labels. An undated opinion is omitted from training. Verify scores and paired green transitions against the original 32 panels. A useful rule must recover dislikes without spending strongly liked titles to do so on independent splits. These tests reuse one viewer's earlier development data.

## Results

Two disliked films and 19 disliked shows had at least two previously rated unrelated titles from the same studio with similar genres on the whole-title split. The studio-context rule caught none of the 40 dislikes and incorrectly turned two liked shows red. In the alternate show-franchise assignment it caught one dislike and incorrectly turned two liked shows red. Adding the matched personal comparisons eliminated all those errors but also eliminated all score changes on all 32 panels. None of the original green five-star titles was lost by either rule. A studio supplied a few good explanations of shared tastes, but there were too few independent personal examples to justify transferring a negative opinion across that studio.

[Script](studio.py) · [Results](studio-results.json)
