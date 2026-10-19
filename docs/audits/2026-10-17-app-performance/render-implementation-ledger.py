#!/usr/bin/env python3
"""Render the maintained repair overlay; never infer acceptance from passing tests."""
import collections,json,pathlib

p=pathlib.Path(__file__).resolve().parent
register=json.loads((p/'findings.json').read_text())
ledger=json.loads((p/'implementation-ledger.json').read_text())
items={entry['id']:entry for entry in ledger['items']}
assert len(items)==len(ledger['items']), 'Duplicate ledger ID'
assert set(items)=={entry['id'] for entry in register['items']}, 'Run consolidation after updating canonical IDs'
assert ledger['baseline']==register['commit'], 'Wrong baseline'
counts=collections.Counter(entry['status'] for entry in items.values())
lines=['# Implementation ledger','',
 ('The known-safe shared implementation pass is closed; unchecked audit work and unverified options are deferred in the [separate follow-up roadmap](follow-up-roadmap.md) at the user’s request. ' if ledger.get('deliveryStage')=='known-safe-pass-closed-follow-up-audit-deferred-by-user' else 'Work remains active. ') + 'This is the current repair overlay for the [pinned baseline audit](README.md). No commit, push, PR or deployment has been made. Every original finding/opportunity/plan lead stays visible; an applied change is not automatically complete acceptance. [Machine-readable ledger](implementation-ledger.json).','',
 '## Reading the evidence','',
 'Actual-data and live-browser checks are recorded separately from controlled regression faults. Complete before/after comparisons, immutable baseline source, current source fingerprints, all samples and remaining gaps belong to each change. Counts below are recorded items, including overlaps, not independent defects or additive savings.','',
 '| Current status | Recorded items |','| --- | --- |']
lines.extend(f'| {status} | {count} |' for status,count in sorted(counts.items()))
lines+=['','## Effective status for every recorded item','','| ID | Status | Source changed | Shared workstream | Baseline finding |','| --- | --- | --- | --- | --- |']
for row in register['items']:
 entry=items[row['id']]
 title=row['title'].replace('|','/').replace('\n',' ')
 lines.append(f"| {row['id']} | {entry['status']} | {'yes' if entry['implementationApplied'] else 'no'} | {row['workstream']} | [{title}]({row['analysis']}) |")
lines+=['','## Evidence and remaining acceptance for applied changes','',
 'The original reports define full consumer sets and alternatives. These entries add current implementation evidence and remaining gates. Related records must not be counted as separate savings.','']
for row in register['items']:
 entry=items[row['id']]
 if not entry['implementationApplied']:continue
 lines+=['### '+entry['id']+' — '+entry['status'],'',entry.get('change',str(entry.get('sharedOwner',''))),'',
  'Evidence: '+', '.join('['+ref+']('+ref+')' for ref in entry['evidenceRefs'])+'.','']
 lines.extend('- '+gap for gap in entry['remaining'])
 lines.append('')
if ledger.get('additionalObservations'):
 lines+=['## Additional runtime observations','',
  'These records sit outside the 94 canonical items. Each status distinguishes observed incidents, source/control proofs, staged proposals, rollout blockers and applied repairs. See [runtime observations](runtime-observations.md).','']
 for observation in ledger['additionalObservations']:
  lines+=['- '+observation['id']+' — '+observation['status']+': '+observation['remaining']]
 lines.append('')
lines+=['## Continuing work and drift','',
 'Open items retain their full alternatives and acceptance in the baseline area reports. They remain unresolved work. Continue at shared owners: request lifetime, eager child materialization, provider finalization, retained DOM, task history and resource budgets. Changes that alter retention, navigation, presentation or major transaction boundaries need a concrete option and its tradeoffs before a decision.','',
 'Keep baseline source hashes immutable. Capture a separate reviewed current inventory after source review, regenerate this register with the overlay, check source against that manifest, and retain verification receipts per batch. Refresh complete comparisons when owner semantics or feature/privacy rules change. A passing regression does not erase actual provider, format, device or scale gaps.','',
 'Regeneration: `python3 consolidate.py`, then `python3 render-implementation-ledger.py` from this directory. Edit implementation-ledger.json deliberately; this renderer never changes a status or marks a test skip as passed.','']
(p/'implementation-ledger.md').write_text('\n'.join(lines))
print({'records':len(items),'statusCounts':dict(counts)})
