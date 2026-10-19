# Audit tooling implementation

The pinned audit remains historical. `evidence/source-inventory.json` was not rewritten by this work.

`inventory.mjs` retains its default manifest path and adds explicit destinations/references:

```sh
node docs/audits/2026-10-17-app-performance/inventory.mjs --output /tmp/current-source-inventory.json
node docs/audits/2026-10-17-app-performance/inventory.mjs --check --reference /tmp/current-source-inventory.json
```

`--output` generates a manifest. `--check --reference` compares file hashes without writing; omitted `--reference` still checks the pinned baseline. `--check --output` and a reference without check are rejected rather than ignored. A current manifest passing a hash check means the captured source has not drifted; it does not establish review or performance correctness. The coordinator must review changes before adopting a current manifest.

`consolidate.py --implementation-ledger PATH` adds a current-status overlay. Without an explicit path it automatically uses the sibling `implementation-ledger.json` if present; without either it preserves baseline-only generation. Ledger schema is `{schemaVersion:1, baseline:<exact audited SHA>, items:[...]}`. Each item needs a canonical unique finding ID, nonempty status and boolean implementationApplied. Optional evidenceRefs must be an array of strings; all additional fields, including remaining acceptance, are retained in the implementation object.

Baseline title, owner, evidence and classification fields remain unchanged. With an overlay, each generated row preserves audit-time implementationApplied as baselineImplementationApplied, exposes the effective boolean at implementationApplied, attaches the full ledger entry as implementation and exposes currentStatus. Unmatched items are explicitly not-addressed with implementationApplied false. The Markdown register links the ledger and includes current status; it no longer states that no fixes have been applied. Unknown/duplicate IDs, wrong baseline/schema, bad booleans and malformed evidence reject before any generated artifact is written.

Interface verification used current source and temporary copies of curated finding files, with no database/provider/browser work. Fourteen contract checks passed, including output/reference round trip, deliberate hash drift, invalid CLI combinations, absent/explicit/automatic overlays, preservation of baseline evidence, effective state, remaining/evidence fields, unmatched entries and six invalid overlay shapes. The baseline source manifest's SHA-256 was identical before and after. The coordinator owns canonical register generation once its implementation ledger is ready. See [tooling evidence](evidence/implementation-audit-tooling.json).
