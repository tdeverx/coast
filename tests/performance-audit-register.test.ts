import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import register from '../docs/audits/2026-10-22-performance-followup/register.json';
import verification from '../docs/audits/2026-10-22-performance-followup/verification.json';
import manifest from '../package.json';
import accountSourceRefresh from '../docs/audits/2026-11-15-invite-accounts/source-refresh.json';
import inviteFollowupSourceRefresh from '../docs/audits/2026-11-15-invite-accounts/followup-source-refresh.json';
import housekeepingSourceRefresh from '../docs/audits/2026-11-15-app-housekeeping/source-refresh.json';
import recommendationSourceRefresh from '../docs/audits/2026-11-16-recommendation-feeds/source-refresh.json';
import providerRowsSourceRefresh from '../docs/audits/2026-11-16-provider-rows/source-refresh.json';
import viewportSourceRefresh from '../docs/audits/2026-11-16-provider-rows/viewport-source-refresh.json';
import pausedTrackingSourceRefresh from '../docs/audits/2026-11-17-paused-tracking/source-refresh.json';
import progressFollowupSourceRefresh from '../docs/audits/2026-11-17-paused-tracking/followup-source-refresh.json';
import menuReadRetrySourceRefresh from '../docs/audits/2026-11-17-menu-read-retry/source-refresh.json';
import menuTrackingSourceRefresh from '../docs/audits/2026-11-17-menu-tracking/source-refresh.json';
import menuRolloutSourceRefresh from '../docs/audits/2026-11-17-menu-rollout/source-refresh.json';
import menuRolloutFollowupSourceRefresh from '../docs/audits/2026-11-17-menu-rollout/followup-source-refresh.json';
import menuPlaybackEligibilitySourceRefresh from '../docs/audits/2026-11-17-menu-rollout/playback-eligibility-source-refresh.json';
import menuResolvedArtistSourceRefresh from '../docs/audits/2026-11-17-menu-rollout/resolved-artist-source-refresh.json';
import menuStatusFeedbackSourceRefresh from '../docs/audits/2026-11-17-menu-status-feedback/source-refresh.json';
import subtitlePlaybackSourceRefresh from '../docs/audits/2026-11-17-subtitle-playback/source-refresh.json';
import diagnosticsFollowupSourceRefresh from '../docs/audits/2026-11-17-diagnostics-followup/source-refresh.json';
import shelfSegmentsSourceRefresh from '../docs/audits/2026-11-18-shelf-segments/source-refresh.json';
import accessNotificationsSourceRefresh from '../docs/audits/2026-11-18-access-notifications/source-refresh.json';
import legacyIntegritySourceRefresh from '../docs/audits/2026-10-17-app-performance/legacy-integrity-source-refresh.json';
import progressSegmentsSourceRefresh from '../docs/audits/2026-11-19-progress-segments-source-refresh.json';

import unifiedProgressSourceRefresh from '../docs/audits/2026-11-19-unified-progress-source-refresh.json';

type SourceRefresh = {previous: string; current: string};
const sourceReceipts = [accountSourceRefresh, inviteFollowupSourceRefresh, housekeepingSourceRefresh, recommendationSourceRefresh, providerRowsSourceRefresh, viewportSourceRefresh, pausedTrackingSourceRefresh, progressFollowupSourceRefresh, menuReadRetrySourceRefresh, menuTrackingSourceRefresh, menuRolloutSourceRefresh, menuRolloutFollowupSourceRefresh, menuPlaybackEligibilitySourceRefresh, menuResolvedArtistSourceRefresh, menuStatusFeedbackSourceRefresh, subtitlePlaybackSourceRefresh, diagnosticsFollowupSourceRefresh, shelfSegmentsSourceRefresh, accessNotificationsSourceRefresh, legacyIntegritySourceRefresh, progressSegmentsSourceRefresh, unifiedProgressSourceRefresh];
const sourceRefreshes: readonly Readonly<Record<string, SourceRefresh>>[] = sourceReceipts.map(receipt => receipt.files);

async function expectCurrentSource(path: string, historicalHash: string, detail: string) {
  // Walk only exact predecessor pins. Dated hosted receipts keep their own epoch.
  const expected = sourceRefreshes.reduce((hash, files) => files[path]?.previous === hash ? files[path].current : hash, historicalHash);
  const actual = createHash('sha256').update(await Bun.file(path).bytes()).digest('hex');
  expect(actual, `${path}: ${detail}`).toBe(expected);
}

test('menu status and feedback changes retain their own bounded acceptance epoch', async () => {
  expect(menuStatusFeedbackSourceRefresh.epoch).toBe('menu-status-feedback-followup-2026-11-17');
  expect(menuStatusFeedbackSourceRefresh.baseline).toBe('b76964dc05680bbd7d4eca2c47291ea8b07ed814');
  expect(menuStatusFeedbackSourceRefresh.blanketAcceptance).toBe(false);
  expect(menuStatusFeedbackSourceRefresh.sourceFrozen).toBe(true);
  const files: Readonly<Record<string,SourceRefresh>> = menuStatusFeedbackSourceRefresh.files;
  for(const [path,pin] of Object.entries(files))
    await expectCurrentSource(path,pin.current,'Review covered request status, icon layout and notification delivery ownership.');
  const supportingFiles: Readonly<Record<string,string>> = menuStatusFeedbackSourceRefresh.supportingFiles;
  for(const [path,hash] of Object.entries(supportingFiles))
    await expectCurrentSource(path,hash,'Review the new feedback and rendered/lifetime regression evidence.');
  const report=await Bun.file(menuStatusFeedbackSourceRefresh.report).text();
  for(const scope of ['b76964d','20 notices','200 records','15-second','Firefox','invalid-response','material changes'])
    expect(report).toContain(scope);
});

test('resolved artist eligibility advances its own immutable review receipt', async () => {
  expect(menuResolvedArtistSourceRefresh.epoch).toBe('menu-resolved-artist-review-2026-11-17');
  expect(menuResolvedArtistSourceRefresh.blanketAcceptance).toBe(false);
  for(const [path,pin] of Object.entries(menuResolvedArtistSourceRefresh.files))
    await expectCurrentSource(path,pin.current,'Review the prepared artist identity eligibility correction.');
  const supportingFiles: Readonly<Record<string,string>> = menuResolvedArtistSourceRefresh.supportingFiles;
  for(const [path,hash] of Object.entries(supportingFiles))
    await expectCurrentSource(path,hash,'Review the prepared artist regression evidence.');
  const report=await Bun.file(menuResolvedArtistSourceRefresh.report).text();
  expect(report).toContain('295c703');
  expect(report).toContain('resolved workId');
  expect(report).toContain('zero additional reads');
});

test('PR eligibility and bootstrap corrections advance exact pins without rewriting published evidence', async () => {
  expect(menuPlaybackEligibilitySourceRefresh.epoch).toBe('menu-playback-eligibility-review-2026-11-17');
  expect(menuPlaybackEligibilitySourceRefresh.blanketAcceptance).toBe(false);
  for(const [path,pin] of Object.entries(menuPlaybackEligibilitySourceRefresh.files))
    await expectCurrentSource(path,pin.current,'Review the PR playback eligibility correction.');
  const supportingFiles: Readonly<Record<string,string>> = menuPlaybackEligibilitySourceRefresh.supportingFiles;
  for(const [path,hash] of Object.entries(supportingFiles))
    await expectCurrentSource(path,hash,'Review the playback eligibility regression evidence.');
  const report=await Bun.file(menuPlaybackEligibilitySourceRefresh.report).text();
  expect(report).toContain('1ef98ad');
  expect(report).toContain('canPlayMusicCard');
  expect(report).toContain('server source authorization');
  expect(report).toContain('standalone container migration copy');
});

test('menu follow-up binds completed local work and bounded proof without promoting provider acceptance', async () => {
  expect(menuRolloutFollowupSourceRefresh.epoch).toBe('menu-rollout-followup-local-2026-11-17');
  expect(menuRolloutFollowupSourceRefresh.blanketAcceptance).toBe(false);
  for (const [path,pin] of Object.entries(menuRolloutFollowupSourceRefresh.files))
    await expectCurrentSource(path,pin.current,'Review the changed follow-up owner and refresh its local evidence.');
  for (const [path,hash] of Object.entries(menuRolloutFollowupSourceRefresh.supportingFiles))
    await expectCurrentSource(path,hash,'Review the follow-up supporting source and its remaining acceptance.');
  const report=await Bun.file(menuRolloutFollowupSourceRefresh.report).text();
  expect(report).toContain('100 actual cards');
  expect(report).toContain('Disposable reading isolation and lifecycle review');
  expect(report).toContain('material investigation');
  expect(report).toContain('must explicitly approve opening a pull request');
});

test('menu rollout binds local source review without claiming complete parity or hosted acceptance', async () => {
  expect(menuRolloutSourceRefresh.epoch).toBe('menu-rollout-local-2026-11-17');
  expect(menuRolloutSourceRefresh.blanketAcceptance).toBe(false);
  for (const [path, pin] of Object.entries(menuRolloutSourceRefresh.files))
    await expectCurrentSource(path, pin.current, 'Refresh the rollout source review and its remaining parity.');
  for (const [path, hash] of Object.entries(menuRolloutSourceRefresh.supportingFiles))
    await expectCurrentSource(path, hash, 'Review the changed rollout supporting owner and its local evidence.');
  const report = await Bun.file(menuRolloutSourceRefresh.report).text();
  expect(report).toContain('Feature parity still open');
  expect(report).toContain('Mark unread and Reset reading position remain planned');
});

test('audit register binds runtime pins and executable owners without promoting open work', async () => {
  expect(register.schemaVersion).toBe(1);
  for (const receipt of sourceReceipts) {
    const actual = createHash('sha256').update(await Bun.file(receipt.report).bytes()).digest('hex');
    expect(actual).toBe(receipt.reportSha256);
  }
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
    await expectCurrentSource(path,expected,'Review the changed contract and record verification for the new source.');
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
    await expectCurrentSource(path,expected,'Refresh the affected actual-data evidence and remaining scope.');
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
    await expectCurrentSource(path,expected,'Refresh continuation evidence and boundaries before accepting changed owners.');
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

test('selected bulk and preview policies bind their own source and evidence epoch',async()=>{
 const selected=register.selectedPolicyImplementation;
 const pins=await Bun.file(selected.pins).json() as {epoch:string;files:Record<string,string>};
 expect(selected.blanketAcceptance).toBe(false);
 expect(pins.epoch).toBe(selected.epoch);
 expect(await Bun.file(selected.report).exists()).toBe(true);
 for(const finding of selected.findings){
  expect(finding.contract.length).toBeGreaterThan(20);
  for(const path of [...finding.owners,...finding.tests])expect(path in pins.files).toBe(true);
 }
 for(const [path,expected]of Object.entries(pins.files))await expectCurrentSource(path,expected,'Rerun the selected-policy contract and retain previous evidence before refreshing pins.');
 const root='docs/audits/2026-10-23-bulk-recovery-input-retention/';
 const actual=await Bun.file(root+'receipts/actual-recovery.json').json();
 expect(actual.status).toBe('passed');
 expect(actual.checks.every((check:any)=>check.pass)).toBe(true);
 for(const receipt of ['browser.json','image-lifetime.json'])expect((await Bun.file(root+'receipts/'+receipt).json()).status).toBe('passed');
 const blockers=await Bun.file('docs/audits/2026-10-22-performance-followup/completion/independent/blockers.json').json();
 for(const finding of selected.findings){
  expect(blockers.items.some((item:any)=>item.id===finding.id)).toBe(false);
  expect(blockers.resolved.some((item:any)=>item.id===finding.id)).toBe(true);
 }
});

test('hosted companion evidence binds permission repairs without promoting party or device acceptance',async()=>{
 const root='docs/audits/2026-10-25-hosted-companion/';
 const pins=await Bun.file(root+'pins.json').json() as {epoch:string;blanketAcceptance:boolean;files:Record<string,string>;companion:{files:Record<string,string>};remaining:string[]};
 expect(pins.epoch).toBe('hosted-companion-2026-10-25');
 expect(pins.blanketAcceptance).toBe(false);
 for(const[path,hash]of Object.entries(pins.files))await expectCurrentSource(path,hash,'Review the changed contract and preserve the original hosted observations.');
 if(await Bun.file('../coast-plugin/README.md').exists())for(const[path,hash]of Object.entries(pins.companion.files))expect(createHash('sha256').update(await Bun.file('../coast-plugin/'+path).bytes()).digest('hex')).toBe(hash);
 const before=await Bun.file(root+'receipts/authorization-before.json').json();
 const after=await Bun.file(root+'receipts/authorization-after.json').json();
 expect(before.cases.find((x:any)=>x.case==='cached-withdrawn').status).toBe(200);
 expect(after.find((x:any)=>x.case==='cached-withdrawn').status).toBe(404);
 const matrix=await Bun.file(root+'receipts/authorization-matrix.json').json();
 expect(matrix).toHaveLength(11);
 expect(matrix.every((x:any)=>x.status===x.expected)).toBe(true);
 const crop=await Bun.file(root+'receipts/crop-process.json').json();
 expect(crop.passed).toBe(true);
 expect(crop.timeout.status).toBe(502);
 expect(crop.timeout.remainingProcesses).toBe(0);
 expect(crop.afterFirstAbort).toBe(1);
 expect(crop.afterFinalAbort).toBe(0);
 for(const engine of ['chromium','webkit','firefox']){
  const r=await Bun.file(root+`receipts/browser-hls-${engine}.json`).json();
  expect(r.passed).toBe(true);
 expect(r.survivorContinued).toBe(true);
  expect(r.encoderCountDuring).toBe(1);
 expect(r.encoderCountAfterFinal).toBe(0);
  expect(r.mediaFilesRemaining).toBe(0);
 expect(r.externalRequests).toBe(0);
 }
 expect((await Bun.file(root+'receipts/browser-hls-too-early.json').json()).passed).toBe(false);
 const cleanup=await Bun.file(root+'receipts/cleanup.json').json();
 expect(cleanup.privateSnapshotDeleted).toBe(true);
 expect(cleanup.temporaryCredentialsDeleted).toBe(true);
 expect(cleanup.ffmpegProcessesAfter).toBe(0);
 expect(cleanup.liveServerHealth).toBe(200);
 expect(pins.remaining).toContain('Coast party orchestration and multi-device synchronization/drift');
});
