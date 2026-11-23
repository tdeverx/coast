# Taste selection and specific preferences

Taste keeps feedback on an observed title independent from the rate at which an affinity appears in the owner's choices. Liking an anime can support its cast, tags, studio and other credits. A sustained shortfall in anime viewing can independently lower matching titles. Within a mixed-genre title, sufficiently supported choices for the same affinity in a different matching genre can take precedence. A studio, creator or other feature can offset that one shortfall when it is positively supported and accounts for a disproportionate share of the owner's choices within that affinity. Common signals across the owner's history have insufficient specificity to act as exceptions. The strongest remaining shortfall applies once. Selection alone cannot push a score below 15%.

The existing Taste refresh owns the work. Movies and shows compare distinct films and whole shows. Music uses albums and maps track plays to the album. Standalone tracks still supply taste feedback. Games use observed play and owned or released games as the reference. Books and comics use separate work cohorts, with publication years when a full date is missing. Non-screen references have higher or lower admission thresholds where appropriate and a smaller adjustment than screen. Restricted accounts sample only their accessible library, and changing to a restricted account invalidates the old profile. The profile shows the choice-adjusted affinity next to enjoyment and the underlying watch or activity counts. The title breakdown shows the applied points and the specific exception when present.

## Holdout results

The account still contained 444 rated movies and 429 rated shows. Whole titles, including their activity, were withheld during training. The first byte of SHA-256 of the canonical work ID modulo five assigns the fold, as in the recorded taste weights replay. Earlier private fold manifests are unavailable for direct comparison. The recreated manifests are 6114795d8a2927e5c7019a3092d14dab76677f5d2afbc308800ed5ca74be7e67 for movies and d269c0ff6c944fd03ddb6a305c5a1724fd252effc2439295c0937eef6da2142e for shows. Each baseline and candidate used the identical reconstructed folds. Training ratings were removed in the unrated run. The comparison uses confidence-weighted current title scores and the established return tie-break, comparing ratings of four or above to three or below within the same fold. Rating labels stay visible only to the evaluation. The experiment excludes friend activity and shortlist admission.

| Cohort | Overall pairwise accuracy | Non-animation pairwise accuracy | Animation pairwise accuracy | Liked in Animation top 20 |
| --- | ---: | ---: | ---: | ---: |
| Movies with ratings | 78.10% → 78.04% | 75.71% → 75.57% | No negative pairs | 16 → 16 |
| Movies without ratings | 69.73% → 69.43% | 65.98% → 65.91% | No negative pairs | 17 → 17 |
| Shows with ratings | 77.78% → 78.18% | 78.17% → 78.69% | 73.42% → 73.42% | 17 → 17 |
| Shows without ratings | 46.05% → 46.74% | 50.39% → 51.35% | 35.44% → 35.44% | 10 → 11 |

Overall top-20 counts and score coverage stayed the same in all four comparisons. The Animation cohorts had 60 movie and 60 show holdouts. Shows had 79 within-Animation positive/negative pairs. The unrated show comparison improved but remained below 50% overall. Early variants penalized highly rated animated titles through incidental tags. Those variants were discarded. The adopted version uses genre-specific counterevidence and filters broad properties out of specific exceptions.


## Work and verification

The history cursor still hydrates its existing 300-work pages. The refresh samples up to 3,000 released titles per availability group for movies and shows, and up to 1,500 for each group in the other media. Previously tracked titles are removed from the opportunity sample. The fitter retains numeric feature membership per distinct choice and publishes up to 64 rules with up to 12 exceptions each. It adds no per-card database queries or remote provider calls.

The read-only screen replay used 4,166 movie and 3,128 show opportunities. Selecting the sample took 104 ms and the bulk metadata reads took 926 ms, including the inspection targets. The new fit over hydrated opportunities took 34–86 ms and added 1.1–1.3 KB to the prepared screen references. Median warm scoring time for 72 preloaded titles was 0.73–1.34 ms at baseline and 0.77–1.31 ms with selection. These timings exclude route overhead and do not measure production tail latency.

Deterministic tests cover rated and unrated fits for all six Taste media, unrelated tags, sparse evidence, scoped exceptions and the inferred score floor. PostgreSQL fixtures exercise publication, profile affinity detail, identical card and admin scores, permission withdrawal, owned games, album access inherited from a track, published reading work and future-release exclusion. Only movies and shows were replayed against observed ratings.
