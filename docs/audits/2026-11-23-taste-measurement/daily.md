# Predict each later rating before revealing that day

The experiment produced **382 forecasts from one person’s original rating dates**. We rebuilt Coast’s ratings-only reference and the personal Bayesian alternatives before each UTC day, using every direct rating from strictly earlier days in the same medium. It starts after 25 earlier ratings. The first movie date contained 250 simultaneous ratings, so 194 of the 444 movies were forecast. The first three show dates brought the history to 239 ratings, leaving 188 of 427 shows. Each eligible title received one forecast per method, including titles on days with no comparable pair. Coast abstained on none. These are dates when the person recorded ratings, which may be later than the viewing or release. Catalogue metadata is the current frozen snapshot.

## Rank and probability tell different stories

The table scores two claims separately. Ordering measures how often the method puts a ≥4-star title above a ≤3-star title **rated on the same day**, so both titles have exactly the same training reference. Brier loss measures how accurately each displayed percentage forecasts an actual ≥4-star rating across **every** eligible title. Smaller loss is better. Coast’s match percentage has no established four-star probability interpretation. The exercise tests whether it can sustain that interpretation. [Daily baseline generator](daily-inputs.ts) · [Daily evaluation](daily-personal.py) · [Model and feature support](personal-counts.md)

| Method | Movie ordering | Movie Brier | Show ordering | Show Brier |
| --- | ---: | ---: | ---: | ---: |
| Earlier personal four-star frequency | 50.0% | .19210 | 50.0% | .21979 |
| Coast | 66.5% | .19921 | 65.4% | .22733 |
| Standalone personal feature counts | 85.8% | .19204 | 65.1% | .21305 |
| Standalone conditional feature pairs | 80.7% | .19348 | 67.5% | .21451 |
| Coast plus individual-feature correction | 82.1% | .20037 | 63.4% | .23074 |
| Coast plus conditional-pair correction | 81.2% | .20107 | 64.4% | .22923 |

For movie ordering the conditional correction gained 14.7 points, but 86 of 109 pairs came from one bulk-rating day, and only four of 85 eligible movie days contributed any strong-versus-weak pairs. All four were before 2022. For shows, 599 pairs came from three of 30 days. The conditional correction lowered show ordering over **all** unequal rating pairs from 61.0% to 59.6%, and five stars versus 3½ from 69.8% to 62.6%. Only two dates contributed the latter comparison for either medium.

The correction increased per-title Brier loss by .00186 on movies and .00190 on shows. The conditional 95% paired, day-block bootstrap intervals were −.00266 to +.00612 and −.00454 to +.00839. Giving each day equal weight instead of each title produced near ties for this correction (movies .21501 to .21499, shows .10778 to .10680). The many ratings imported together matter to conclusions. These intervals condition on the recorded predictions and do not quantify uncertainty across viewers.

For movies rated in 2022–23, the conditional correction reduced daily-replay Brier loss from .21560 to .21245. On movies rated from 2024 onward it increased loss from .12843 to .12923. This has the same early/late direction as the earlier fixed-origin experiment, but the daily data provide no independent strong-versus-weak **ordering** comparison for either period. Those fixed-origin tests can rank titles rated on different dates because the training reference stays frozen during the complete window. The daily test can learn the prior day’s ratings and measures a different question.

## What happens to Animation and Sci-Fi?

These are overlapping subgroups of the same 382 forecasts. They measure how the model behaved on the documented personal examples.

| Later direct ratings | Actually ≥4 | Mean Coast → conditional match | Coast → conditional Brier |
| --- | ---: | ---: | ---: |
| Animation movies | 32 / 36 | 83.5% → 86.0% | .099 → .096 |
| Sci-Fi movies | 28 / 42 | 84.7% → 87.0% | .249 → .254 |
| Animation shows | 25 / 42 | 79.0% → 76.5% | .260 → .249 |
| Sci-Fi & Fantasy shows | 59 / 87 | 87.4% → 90.5% | .251 → .260 |

Sci-Fi provides a reason to settle the meaning of the displayed percentage. Of the 14 movies below four stars, **12 still earned 3½ stars**. For shows it was **22 of 28**. If the intended outcome is enjoying a title, treating all of those as misses may understate how much the viewer likes the genre. If the intended outcome is a four-star rating, raising those already-high scores worsened the forecast. The two eligible anime movies were both Studio Ghibli and both earned at least four stars. Coast already averaged 89% on them. This cannot distinguish the Ghibli effect from anime, or establish how the viewer would have rated an unfamiliar non-Ghibli anime.

A rolling, equal-day reveal with the viewer’s own rating frequency as a probability baseline belongs alongside franchise holdouts. Separate favourite-versus-acceptable ordering and probability calibration remain more informative than adding an unconditional preference-pair bonus. The two helpers run offline and use no audience, peer or implicit data. The frozen feature capture and original rating-date feed remain private. [Earlier fixed-origin evidence](ordinal.md)
