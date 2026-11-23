# What a Coast taste match should mean

A viewer opens the card for a film they have never seen. Coast should answer **“Knowing what I enjoy, how good a match is this for me?”** It should be able to give a useful answer on a server with one user, using that person’s entire history, ratings and interactions plus descriptive information about the film. The same goal applies to shows. Validate those two first, then assess the other media on their own terms.

This is the product target for comparing methods. The [research record](audits/2026-11-23-taste-measurement/README.md) tracks what currently meets it, where it falls short, and which trade-offs we would accept.

Coast fits a personal model for each enabled medium in the Taste profiles job. Cards, the item dialog and the admin inspector share the same dynamic score. The profile Taste tab shows the preferences behind it. Friend comparisons fit the same kinds of affinities using only the history and ratings each person shares. The existing For You row generator still selects and orders titles separately. [Held-out evaluation](audits/2026-11-23-taste-v2/README.md) · [Friend comparisons](audits/2026-11-23-taste-v2/social.md) · [For You score distribution](audits/2026-11-23-taste-raw-start/browse-dispersion.md)

The movie and show scorer retains the calibrated personal estimate unless the viewer's other rated works support an adjustment. It compares verified creative teams, tests personal agreement with sufficiently supported TMDB ratings, and checks combinations of company, people, credits and story. For the last two rules the closest liked comparison limits the penalty. A tie keeps the personal estimate. An unseen title uses the full profile. A known title uses a model trained with its family held out, so its own rating cannot supply its prediction. [Creative teams](audits/2026-11-23-taste-raw-start/README.md) · [Personalised reception](audits/2026-11-23-taste-raw-start/positive-evidence.md) · [Similarity cap](audits/2026-11-23-taste-raw-start/margin.md) · [Highly rated titles](audits/2026-11-23-taste-raw-start/favourite-tail.md)

## The number on the card

- Show one personal match percentage. Around 50 means the evidence for and against enjoyment balances. Higher and lower scores should both be attainable. Reserve the extremes for unusually consistent evidence. A title with too little evidence for a personal judgment can have no score.
- A high score should identify something the viewer is likely to enjoy, even when it comes from a genre they rarely choose. A weak title can share an actor, studio or broad genre with several favourites. We need evidence that distinguishes them before confidently separating their scores.
- Preserve the distinction between **strength of preference** and **confidence in the prediction**. A person can love a director after two films while Coast has little evidence for predicting the third. A card breakdown should make this distinction understandable.
- Use “match” for now. Calling 80% an 80% *chance of liking a title* would require showing that the viewer actually likes about eight out of ten comparable predictions across future observations. A 3½-star rating may mean “I enjoyed it”. Evaluate that outcome separately from awarding four stars or finding a favourite. The card, personal breakdown and a fresh background calculation should agree when they use the same inputs and scoring mode.

## What goes into the profile

| Evidence | What Coast should learn |
| --- | --- |
| The viewer’s own ratings | Apply the rating to features of that title. A strong opinion carries more influence than a middling one. Several independent titles provide more support than one. Keep the absolute meaning of the stars across the viewer’s lifetime. A rating’s age alone gives no reason to lower its value. |
| What the viewer actually said | Five stars explicitly endorses that title. A preference for its director, genre or studio is an inference. Describe it as such. If Coast ever lets the viewer confirm a trait directly, distinguish a lasting preference from a one-off request such as “a less violent film tonight”. |
| Viewing and deliberate choices | A verified watch shows the viewer chose the title. Repeated voluntary returns, revisiting a series or collection, a favourite and explicit drops can reveal stronger preferences. Learn separately how well each signal predicts enjoyment. A convincing return pattern can carry real weight for someone who never rates. |
| Conflicting actions | Preserve both sides. A person can rewatch a three-star title or pause something they love. An explicit drop plus a poor rating is strong counterevidence. A pause, an unfinished ongoing show, a watchlist entry or falling behind has a different meaning. |
| Title characteristics | Start with genres and meaningful tags. Use verified cast, writers, directors, show creators, studios, networks and franchise identity when the viewer’s history supports them. Treat decade, certificate, language and country as supporting context. Let real predictive evidence by medium determine influence and uncertainty. |
| Combinations and exceptions | Keep evidence scoped. If the viewer regularly chooses Ghibli and enjoys its films, an unfamiliar Ghibli title can be a strong match even if they rarely choose other anime. Apply the same reasoning to directors, studios, subgenres and other combinations. Check whether the viewer experienced each feature independently before claiming to know which one mattered. |
| Missing data | An absent credit, unknown certificate or unrecorded viewing opportunity is an unknown. A title can be absent from history because the viewer never encountered it. Record confidence accordingly. |

Count a canonical movie or show once as an opinion. Keep independently meaningful episode, season or rewatch evidence attached to that work. Imports that describe the same watch must not manufacture enthusiasm. Preserve the distinction between a date-of-release mark and a known viewing session when interpreting prompt viewing or binges.

The core profile must work with nobody else’s ratings and with provider audience scores absent. A provider average is a separate optional input to test for incremental value. Any social comparison is a separately identifiable feature with its own permissions. A small private server needs the same personal scoring contract as a larger one.

## Cases every candidate should face

| Case | Success looks like |
| --- | --- |
| New viewer with no usable evidence | Withhold the personal percentage. Begin learning as the viewer tracks or rates titles. |
| Two five-star science-fiction films | Learn a strong positive opinion about the shared evidence and report its limited breadth. Test an unseen close match and a title sharing only the broad genre. Neither film alone establishes a preference for every actor or tag it contains. |
| Two five-star ratings plus a middling or low rating | A middling rating should temper the inference less than a one-star rating. Check which specific features the counterexample shares before lowering unrelated affinities. |
| A long unrated history | Recognise distinct choices and deliberate returns. Evaluate the profile against the same viewer’s hidden opinions with every training rating removed. Show the coverage and the limits of predictions about dislike. |
| A strong exception inside a weak category | Keep strongly supported exceptions visible. Evaluate related and unrelated titles alongside them. A scarcity of watches can suggest selective viewing. Direct negative opinions provide stronger evidence about dislike. |
| Well-matched metadata on a film the viewer disliked | Count the false high, inspect the closest positive and negative precedents, and record whether the available details actually distinguish them. Two titles that look identical to the model set a limit on what reweighting can achieve. |
| An inaccurate or incomplete catalogue entry | Correcting tags or credits should change the next score that uses the updated facts. Deleting all comparable title information should allow the scorer to withhold the match. |

## How to decide whether a change is worthwhile

1. **Hide the whole target.** Withhold its rating, watch, repeats, child history and endorsements. Rebuild the personal profile, score the target, then reveal its feedback. Also hold out whole franchises. For time-based checks, use only opinions already available at prediction time and keep rating batches together. Today’s metadata can limit historical accuracy.
2. **Test the conditions the product serves.** Run with ratings, without ratings and with just a few. Remove provider opinions and all other users. Compare movies and shows separately. Test a familiar niche, adjacent titles and the rest of the catalogue. One viewer is sufficient to test that viewer’s profile. Other independent single-viewer replays can test generality without sharing anyone’s ratings between profiles.
3. **Measure preference and error.** Count how often liked titles outrank weak ones, how often favourites outrank middling titles, and how many genuine favourites and known dislikes land in the green band. Also report score coverage, abstentions, the actual counts in each band, and evidence available for the low end. Show whether the number works on individual cards as well as in an ordered list.
4. **Record the trade-off.** For each candidate record the hypothesis, matched baseline, winners, losers, denominators, uncertainty and concrete examples. A broader spread is useful when it separates tastes more faithfully. A gain confined to one medium can justify a medium-specific experiment. Consistently removing real favourites to eliminate a few false highs needs an explicit product decision.
5. **Keep an untouched check.** Repeated comparisons on the same history help diagnose errors. Preserve a prediction made before the viewer supplies new feedback to test whether an improvement generalises. Where evidence is sparse, record the result as inconclusive.

The background job can spend time understanding the full history. Item scoring compares that saved personal profile with the item’s current features. Choosing when to run the comparison is an engineering decision. First establish that the comparison predicts personal enjoyment. Row retrieval and For You ranking can then reuse the same evidence.


## Optional synopsis matching

Operators can encode movie and show descriptions offline for the story-and-credit comparison. The ordinary scorer works with the catalogue metadata already available. The export includes only descriptions that need encoding, and a changed description immediately makes its old vector ineligible. The web process never downloads weights or makes an inference request. A scheduled taste refresh picks up updated examples from the viewer's history.

Use the server's normal database environment for the two Bun commands. The encoder runs separately with Python 3.11+, NumPy and ONNX Runtime. Supply the pinned `onnx/model_qint8_arm64.onnx` and `vocab.txt` files. It verifies both checksums before encoding. The reference repository also lists the byte-identical signed int8 AVX512 files. Keep exported descriptions and vectors outside source control. [Pinned encoder files](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/1110a243fdf4706b3f48f1d95db1a4f5529b4d41)

```sh
bun scripts/taste-synopses.ts export descriptions.ndjson
python3 scripts/encode_taste_synopses.py descriptions.ndjson model_qint8_arm64.onnx vocab.txt vectors.ndjson
bun scripts/taste-synopses.ts import vectors.ndjson
```
