import {expect,test} from 'bun:test';
import {summarizeSamples,compareBenchmarks,type BenchmarkRun} from '../src/lib/benchmarks/model';
test('sample medians and nearest-rank p95 handle one, odd, even and unordered samples',()=>{
 expect(summarizeSamples([7],1)).toEqual({samplesMs:[7],medianMs:7,p95Ms:7,rows:1});
 expect(summarizeSamples([9,1,5],1).medianMs).toBe(5);
 expect(summarizeSamples([10,2,8,4],1).medianMs).toBe(6);
 expect(summarizeSamples(Array.from({length:20},(_,i)=>20-i),1).p95Ms).toBe(19);
});
const run=(id:string,median=10)=>({id,state:'completed',workloadVersion:'v1',comparisonKey:'same',errors:[],measurements:{datasetChanged:false,backgroundActivity:false,probes:{query:{medianMs:median}}}} as unknown as BenchmarkRun);
test('drift comparisons require successful matching workload, dataset and environment without background jobs',()=>{
 expect(compareBenchmarks(run('new',12),run('old'))?.changes.query).toBeCloseTo(20);
 for(const change of [{comparisonKey:'different'},{workloadVersion:'v2'},{state:'failed'},{errors:['timeout']}])
  expect(compareBenchmarks({...run('new'),...change} as BenchmarkRun,run('old'))).toBeNull();
 for(const property of ['backgroundActivity']){
  const changed=run('new');(changed.measurements as any)[property]=true;
  expect(compareBenchmarks(changed,run('old'))).toBeNull();
 }
});

test('fixed probes retain drift comparisons across catalogue changes while Collection stays in its dataset cohort',()=>{
 const older=run('old'),newer=run('new',20);
 older.context={datasetFingerprint:'catalogue1'} as any;newer.context={datasetFingerprint:'catalogue2'} as any;
 for(const record of [older,newer]){record.measurements!.probes={'Journal 6000 events':{...record.measurements!.probes.query},'Collection membership and page':{...record.measurements!.probes.query}};}
 expect(compareBenchmarks(newer,older)?.changes['Journal 6000 events']).toBe(100);
 expect(compareBenchmarks(newer,older)?.changes['Collection membership and page']).toBeUndefined();
 newer.context!.datasetFingerprint='catalogue1';expect(compareBenchmarks(newer,older)?.changes['Collection membership and page']).toBe(100);
});
