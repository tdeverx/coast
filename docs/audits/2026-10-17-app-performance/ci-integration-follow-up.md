# PR integration fixture corrections

The initial PR41CI run failed the same four assertions on PostgreSQL15.19 and17.11. Three route fixtures lacked the real `Request` now consumed by shared cancellation paths; the grouped Activity fixture assumed that Bun decodes PostgreSQL UUID arrays as JavaScript arrays. The actual-data original/current DTO comparisons had preserved the native representation.

Route fixtures now provide genuine matching Request/URL context. Activity grouping compares exact ordered members with an independent native `array_agg` over the two known persisted fixture event IDs, retaining root, count, caption and reaction assertions. No runtime fallback, output conversion or application owner changed.

Focused disposable authored-fixture integration and the subsequent full CI matrix are supplementary correctness checks. They are not actual-catalogue performance evidence; the separately recorded real-data owner comparisons retain their tested epochs. Each focused suite creates/migrates/drops its own database and private data directory, never using the retained actual clone or normal installation as a fixture target.

The exact committed PR checks and completed Codex review remain the delivery gates; a local focused pass does not authorize merging a failed matrix.

Focused local integration passes **38tests /333assertions /0failures** across Activity fallback and both reading suites. Each suite used its own migrated authored-fixture database; cleanup confirms no owned fixture database remains. This is supplemental correctness, not new real-data performance evidence.
