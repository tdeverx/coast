# Evidence tests after the browsing audit

Keep the selected rules. We tested 14 bounded changes to how content evidence moves a score, across 870 single-title refits, two 870-title franchise panels, and 382 strictly earlier-day cases. A candidate needed to retain the eight identified dislikes, avoid new false-red favourites and show consistent improvement across splits and genres. None passed. There was one viewer, and the different splits reuse many of the same works.

## Does a keyword or credit add information?

For each particular keyword or credit shared with the target, compare independently rated similar works carrying that characteristic against matched works without it. Comparisons are within medium and genre and exclude the target's own family. We tested keyword, credit, corroboration from disjoint families, and positive-only arms, followed by variants using the errors on other out-of-sample personal predictions. [Prespecified comparisons and follow-up](matched-traits-protocol.md) · [Runnable evaluation](matched_traits.py)

| Movie experiment | Change in favourite-versus-dislike ordering, percentage points | Full / franchise / reassigned / earlier |
| --- | --- | --- |
| Keyword pair, using past personal ratings | Mixed generalisation | −0.72 / +0.59 / −6.11 / +1.69 |
| Keyword pair, using withheld forecast errors | Mixed generalisation | +0.92 / +1.97 / −6.33 / +0.55 |
| Credit pair, using withheld forecast errors | Little coverage | +0.09 / −0.11 / −0.07 / 0.00 |

The keyword error method raised two movie dislikes on the reassigned panel. Even on the single-title panel it lowered 11 four-star-or-better films. Movie Drama ordering improved by 3.03 points on the single-title replay and worsened by 5.83 on reassigned families. We could not measure favourite-versus-dislike ordering in movie Animation or Science Fiction because those cohorts contain zero directly rated dislikes.

Raw credit comparisons lifted 13 four-star-or-better shows and zero other shows on the single-title replay, but also lifted two dislikes on reassigned families. The positive-only error variant preserved every favourite's score or raised it, while still raising two reassigned dislikes and reducing Animation ordering by 3.43 points on that split. The two-signal checks usually abstained. None separated additional negative films reliably.

## Does duration help?

The copied database supplied film lengths for 310 of the 444 rated films and representative episode lengths for 417 of the 426 shows. We tested a linear within-genre effect and a local preference for durations similar to the target's, each using raw outcomes, independently forecast residuals, or agreement of both. Missing duration abstains. [Duration protocol](duration-protocol.md) · [Copied catalogue query](duration-capture.ts) · [Held-out evaluation](duration_replay.py)

The local film-length rule improved full-history ordering by 3.37 points and original-franchise ordering by 6.92, but reduced reassigned ordering by 1.21 and earlier-day ordering by 1.09. It lowered 20 four-star-or-better films on the single-title replay. Requiring both outcome and error estimates to agree still lowered 19 favourites, and had zero support in the earlier movie panel. Raw duration in shows moved many titles the viewer liked in both directions. The local-duration arm lowered 46 four-star-or-better shows and increased mean absolute error by 0.17 points on the full replay. Reliable film/movie-length metadata would be useful elsewhere, but these outcomes do not justify using runtime to spread card scores.

Across all 14 candidates every original red dislike kept its score. This protection is part of the experimental policy. It does not validate the estimates for the remaining titles.
