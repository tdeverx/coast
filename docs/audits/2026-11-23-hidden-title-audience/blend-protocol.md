# A direct public-score blend as a comparison

Use the same title-only holdouts and personal creator-plus-executive baseline as the local agreement experiment. Test six fixed blend weights before examining their results: 0%, 5%, 10%, 20%, 40% and 100%. A blend percentage means a share of the estimate, distinct from the two-, four- and eight-point caps on the local agreement rule.

Convert the current ten-point TMDB average to stars and then to the same utility scale Coast uses to evaluate the personal forecast. Multiply the nominal weight by votes / (votes + 50). The forecast is the weighted average of the personal score and the converted crowd score. Missing reception leaves the personal estimate intact. Even at a nominal 100%, a small public sample still leaves some weight on the personal baseline.

Report both error against the existing utility target and error against a linear star percentage (stars × 20). Compare the two prespecified private examples at every weight, and inspect false negatives alongside recovered dislikes.

For the 20% and 40% direct blends, estimate paired uncertainty on the difference in mean absolute utility error against the creator-plus-executive baseline. Resample whole canonical franchises within each medium with replacement 2,000 times, using a fixed seed. Negative differences favour adding TMDB. These intervals describe variation within this retrospective account sample, conditional on the fitted forecasts.
