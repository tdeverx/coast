import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import register from '../docs/audits/2026-10-22-performance-followup/register.json';
import verification from '../docs/audits/2026-10-22-performance-followup/verification.json';
import manifest from '../package.json';

test('audit register binds runtime pins and executable owners without promoting open work', async () => {
  expect(register.schemaVersion).toBe(1);
  expect(manifest.packageManager).toBe(`bun@${register.runtime.bun}`);
  const docker = await Bun.file('Dockerfile').text();
  const workflow = await Bun.file('.github/workflows/verify-and-publish-preview.yml').text();
  expect(docker).toContain(register.runtime.bunImage);
  expect(workflow).toContain(register.runtime.bunImage);
  expect(workflow).toContain(register.runtime.bun);
  expect(new Set(register.findings.map(x => x.id)).size).toBe(10);
  expect(new Set(register.workstreams.map(x => x.id)).size).toBe(9);
  expect(new Set(register.historicalItems.map(x => x.id)).size).toBe(19);
  for (const finding of register.findings) {
    expect(finding.contract.length).toBeGreaterThan(20);
    expect(finding.tests.length).toBeGreaterThan(0);
    for (const path of [...finding.owners, ...finding.tests]) {
      expect(await Bun.file(path).exists()).toBe(true);
    }
    if (finding.status === 'implemented-partial-acceptance' || finding.status === 'trial-rejected') {
      expect(finding.remaining.length).toBeGreaterThan(0);
    }
  }
  expect(register.findings.find(x => x.id === 'AUD-08')?.status).toBe('trial-rejected');
});

test('changed audit owners require an explicit evidence and remaining-scope refresh', async () => {
  expect(verification.source.baseline).toBe(register.baseline.applicationRef);
  for (const finding of register.findings) {
    for (const path of finding.owners) {
      expect(path in verification.source.files).toBe(true);
    }
  }
  for (const [path, expected] of Object.entries(verification.source.files)) {
    const actual = createHash('sha256').update(await Bun.file(path).bytes()).digest('hex');
    expect(actual, `${path}: review its registered contract, rerun affected acceptance and refresh verification; do not silently reuse an old evidence epoch.`).toBe(expected);
  }
});

test('expanded audit binds reviewed receipts and preserves incomplete acceptance boundaries',async()=>{
  const root='docs/audits/2026-10-22-performance-followup/completion/';
  const coverage=await Bun.file(root+'coverage.json').json();
  const pins=await Bun.file(root+'source-pins.json').json() as {files:Record<string,string>};
  const evidence=await Bun.file(root+'evidence-files.json').json() as {files:Record<string,string>};
  expect(coverage.families.length).toBe(coverage.historicalFamilyCount);
  expect(new Set(coverage.families.map((family:any)=>family.id)).size).toBe(coverage.historicalFamilyCount);
  expect(coverage.workstreams.map((stream:any)=>stream.id)).toEqual(register.workstreams.map(stream=>stream.id));
  for(const stream of coverage.workstreams){
    expect(stream.remaining.length).toBeGreaterThan(0);
    for(const receipt of stream.receipts)expect(await Bun.file(root+receipt).exists()).toBe(true);
  }
  for(const family of coverage.families){
    if(family.positiveCohortAccepted)expect(family.evidence.some((entry:any)=>entry.status===200&&(entry.items>0||entry.total>0))).toBe(true);
    for(const entry of family.evidence)expect(await Bun.file(root+entry.receipt).exists()).toBe(true);
  }
  for(const[path,expected]of Object.entries(pins.files)){
    expect(createHash('sha256').update(await Bun.file(path).bytes()).digest('hex'),`${path}: refresh the affected actual-data evidence and remaining scope.`).toBe(expected);
  }
  for(const[path,expected]of Object.entries(evidence.files)){
    expect(createHash('sha256').update(await Bun.file(root+path).bytes()).digest('hex'),`${path}: preserve the result or record an explicitly reviewed evidence epoch.`).toBe(expected);
  }
});

test('independent continuation binds current owners, real-data receipts and explicit blockers',async()=>{
  const root='docs/audits/2026-10-22-performance-followup/completion/independent/';
  const pins=await Bun.file(root+'source-pins.json').json() as {files:Record<string,string>;companion:{files:Record<string,string>}};
  const results=await Bun.file(root+'verification.json').json();
  const blockers=await Bun.file(root+'blockers.json').json();
  expect(new Set(register.continuation.findings.map(item=>item.id)).size).toBe(4);
  for(const finding of register.continuation.findings){
    expect(finding.contract.length).toBeGreaterThan(20);
    for(const path of [...finding.owners,...finding.tests])expect(path in pins.files).toBe(true);
  }
  for(const[path,expected]of Object.entries(pins.files)){
    expect(createHash('sha256').update(await Bun.file(path).bytes()).digest('hex'),`${path}: refresh continuation evidence and boundaries before accepting changed owners.`).toBe(expected);
  }
  if(await Bun.file('../coast-plugin/README.md').exists())for(const[path,expected]of Object.entries(pins.companion.files)){
    expect(createHash('sha256').update(await Bun.file('../coast-plugin/'+path).bytes()).digest('hex'),`${path}: rerun affected companion acceptance and refresh its evidence epoch.`).toBe(expected);
  }
  expect(results.blanketAcceptance).toBe(false);
  expect(blockers.items.length).toBeGreaterThan(0);
  expect(blockers.items.find((item:any)=>item.id==='BLOCK-AUTO-REVIEW-JOBS')?.kind).toBe('explicit-approval');
  const roadmap=await Bun.file('docs/roadmap.md').text();
  const handoff=await Bun.file('docs/audits/2026-10-17-app-performance/follow-up-roadmap.json').json();
  expect(handoff.currentAuditHandoff.remainingIds).toEqual(blockers.items.map((item:any)=>item.id));
  for(const item of blockers.items)expect(roadmap).toContain(item.id);
  for(const receipt of results.acceptedReceipts)expect(await Bun.file(root+receipt).exists()).toBe(true);
  const probes=await Bun.file(root+'probe-pins.json').json();
  for(const probe of probes.files){
    expect(createHash('sha256').update(await Bun.file(root+'probes/'+probe.file).bytes()).digest('hex')).toBe(probe.transcriptSha256);
  }
});
