# What overpowered the low ratings

The experiment hid the whole title, including the viewer's rating, watch and returns. Recreating each original five-way title split reproduced all 873 stored predictions and abstentions. The comparison below covers the seven films and 33 shows the viewer rated at most 2½ stars. Detailed title-by-title output contains personal viewing data and is generated privately.

| Median among disliked targets | Movies | Shows |
| --- | ---: | ---: |
| Ordered ratings model at zero feature offset | 77.01 | 71.32 |
| Rating component with the title's actual metadata | 77 | 67 |
| Viewing component with the title's actual metadata | 74 | 64 |
| Combined personal component after scaling | 82 | 70 |
| Retained signed affinity component | 81 | 81.5 |
| Combined score before display calibration | 81 | 76 |
| Final card score | 79 | 70 |

There are two sources of upward pressure. The ordered rating model learns that most titles this viewer rates are good. In the absence of a distinguishing characteristic, its estimate starts appreciably above neutral. The second component, which gets half the vote on this mature profile, averages signed preferences across the title's matched traits. On 30 of the 32 disliked shows with enough evidence for this component, it raised the personal prediction. On the remaining show it abstained; on films it raised three and lowered four.

On all 40 titles, the sum of positively attributed points exceeded the magnitude of negatively attributed points. The median magnitudes on films were +18.08 and −0.96 points; on shows they were +14.90 and −2.88. These are point allocations from the actual final breakdown. Its “starting fit” is a residual after attributing personal and family signals, and has a different meaning from the ordered model's starting expectation. In particular, a row such as “genres · Fantasy” assigns the **whole genre family's contribution** to one representative label. Removing Fantasy and scoring again can yield a much smaller change. Actual one-feature removals and scores with all genre/tag/theme descriptors removed are available in the diagnostic output.

The misses differ in what the model could plausibly have learned. On one comic-book show, removing its genre, tag and theme metadata moved the score from 85 to 58. A five-star show in the same held-out fold scored 86 and shared both the underlying comic/superhero description and production organisations. In another case, the model did recognise a negative studio pattern: both other rated works from the studio were disliked. Including the studio moved the estimate from 73 to 70, while the animation genre raised it four points. A reality show moved from 65 to 56 when its Reality genre was included, leaving it above neutral despite a substantial downward effect. These score differences involve recomputing the model, so overlapping removals cannot be added together.

The production model stores interaction terms but omits them from both projections used for personal card predictions. Only one of the 40 dislikes even matched a learned interaction in its actual training fold. Its offset was −1.75 before blending. That omission cannot explain the other 39 predictions.

## Reproduce with frozen private files

Run the project's pinned Bun executable from the workspace. The input hashes must match the original graded receipt.

```sh
bun docs/audits/2026-11-23-taste-dislikes/breakdowns.ts CAPTURE VERIFIED_CREDITS INDEPENDENT_CATALOGUE GRADED_HOLDOUTS
```

The diagnostic recomputes every held-out target with the native scorer, verifies the result, and emits one JSON line per title rated at most 2½. It reports stage scores, signed point allocations, score changes from individually removing traits, and a five-star control. Each control is selected from the same test fold by inverse-frequency-weighted Jaccard similarity over content, people and production metadata. A closest match may still share very little. It helps identify where a proposed fix could hurt a favourite and does not prove the reason for a viewer's rating.
