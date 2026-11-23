# Does the final personal scorer recognise exceptions?

The named checks below use the sealed graded model on the copied account. For each unfamiliar anchor, the evaluator holds its other descriptive metadata fixed and scores four versions: neither trait, the first trait alone, the second alone, and both. The table reports the median over the same anchors in each cell. These are controlled sensitivity checks. The unfamiliar titles have no outcome labels, and the difference between four medians cannot establish a causal interaction.

| First / second trait | Eligible unfamiliar anchors | Rated roots in the four cells | Candidate median fit | Fit with training ratings hidden |
| --- | ---: | --- | --- | --- |
| Studio Ghibli / anime tag | 83 | 441 / 0 / 0 / 3 | 80 / 80 / 81 / 81 | 76 / 78 / 76 / 78 |
| Christopher Nolan / science fiction | 566 | 316 / 0 / 126 / 2 | 80 / 80 / 80 / 80 | 78 / 79 / 78 / 79 |
| Pixar / animation | 622 | 384 / 0 / 45 / 15 | 80 / 80 / 81 / 81 | 79 / 81 / 79 / 81 |
| HBO / drama | 1,540 | 157 / 1 / 259 / 12 | 76 / 77 / 81 / 83 | 66 / 66 / 70 / 70 (1,534 anchors) |

All three Ghibli films were highly rated (mean 4.67). The dataset supplies zero separately rated non-Ghibli anime and zero Ghibli films outside that tag. It supports a positive observation about those works. It cannot tell the model that the viewer generally dislikes anime but specifically makes an exception for this studio. The non-Pixar animation films averaged 4.30 versus 4.10 for Pixar animation. Only two scored films combine the named director and science fiction. The sole HBO-only rating leaves little evidence for separating that network's contribution from drama. Independent positive or negative evidence about individual traits remains eligible even when a specific interaction is unidentifiable.

## What actually influences a card

The model fitted five conditionally identifiable interaction records on rated films and nine on shows. None of the four named pairs met its evidence condition. Removing every stored pair and rescoring all 4,892 movie and 3,558 show catalogue entries produced **exactly identical scores and abstentions**. The same deletion had zero effect with training stars masked. Both fully rated native profiles had their fitted display projection active.

This matches the implementation. The experimental context arm admits a guarded joint offset after independently observing four groups. The accepted calibrated profile records that evidence, but its card-scoring path projects separate rating and viewing trait models, blends a signed personal reference, then grades the result. The rating and viewing projections explicitly use empty pair tables. A score differing across both toggles can come from their individual contributions, normalisation and final grading. The selected scorer does not add the learned joint offsets. The retained show viewing reference also contained zero return-combination tiebreak entries for this account. [Native model](../../../src/lib/social/taste-v2.ts)

## Literal network and theme

The copied capture has zero literal theme entries among all 429 rated shows or 3,558 catalogue shows (and zero among all 444 rated movies or 4,892 catalogue movies). Drama is a genre. A numerical result for a real network/theme pair would therefore be unsupported.

A deterministic show fixture supplies 20 unrelated canonical works in each of four groups: neither (3½ stars), network alone (2½), theme alone (2½), and both (five). Its context experiment learned a +10-point interaction and the target scored 84 with it, 74 without. The accepted calibrated stage also stored the +10 record, but scored the same target 80 with it and 80 without. Its display projection retained the identity on this synthetic training distribution. A second fixture retained only the neither/both groups. Both stages declined to fit any interaction when independent comparisons were absent.

The existing three focused regression tests for independent evidence, supported effects and omission of descriptive joint evidence passed. The [full result](exceptions-results.json) includes per-cell rating counts, means, independently grouped counts, abstentions and both fixture outputs. The [aggregate-only checker](exceptions.ts) reads the same capture, credit metadata, independent catalogue and calibrated pair manifest as the frozen replay.

```sh
COAST_TASTE_REPLAY_STAGE=calibrated bun docs/audits/2026-11-23-taste-v2/replay.ts pairs "$capture" "$dates" "$new_private_pairs" "$metadata" "$catalogue"
bun docs/audits/2026-11-23-taste-dislikes/exceptions.ts "$capture" "$metadata" "$catalogue" "$new_private_pairs"
bun test tests/taste-v2.test.ts -t 'interaction|joint evidence'
```
