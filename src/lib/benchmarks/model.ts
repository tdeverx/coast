export const benchmarkVersion = 'coast-local-v1';
export type BenchmarkState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BenchmarkSamples = { samplesMs: number[]; medianMs: number; p95Ms: number; rows: number };
export type BenchmarkMeasurements = {
  wallMs: number; cpuUserMs: number; cpuSystemMs: number;
  memoryBefore: { rss: number; heapUsed: number; external: number };
  memoryAfter: { rss: number; heapUsed: number; external: number };
  peakObservedRss: number; peakObservedHeap: number;
  probes: Record<string, BenchmarkSamples>; datasetChanged: boolean; backgroundActivity: boolean;
};
export type BenchmarkContext = {
  build: string; runtime: string; platform: string; arch: string; osRelease: string;
  cpuModel: string; cpuCount: number; hostMemoryBytes: number;
  memoryLimit: string | null; cpuLimit: string | null; database: string;
  databaseSettings: Record<string,string>; backgroundJobs: number; dataset: Record<string, number>;
  datasetFingerprint: string; environmentFingerprint: string;
};
export type BenchmarkRun = {
  id: string; actionId: string | null; userId: string | null; state: BenchmarkState;
  workloadVersion: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
  context: BenchmarkContext | null; measurements: BenchmarkMeasurements | null;
  comparisonKey: string | null; errors: string[];
  previousId?: string; changes?: Record<string, number>;
  comparisons?: Record<string,{previousId:string;createdAt:string;percent:number}>;
};
export function summarizeSamples(samplesMs: number[], rows: number): BenchmarkSamples {
  const sorted = [...samplesMs].sort((a,b)=>a-b);
  return { samplesMs, medianMs: sorted.length ? (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)])/2 : 0,
    p95Ms: sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)] ?? 0, rows };
}
export function compareBenchmarks(current: BenchmarkRun, previous: BenchmarkRun) {
  if (current.state!=='completed' || previous.state!=='completed' || !current.comparisonKey ||
    current.comparisonKey!==previous.comparisonKey || current.workloadVersion!==previous.workloadVersion ||
    current.errors.some(error=>error!=='dataset-changed') || previous.errors.some(error=>error!=='dataset-changed') || current.measurements?.backgroundActivity || previous.measurements?.backgroundActivity) return null;
  const changes: Record<string,number> = {}, comparisons:NonNullable<BenchmarkRun['comparisons']>={};
  for (const [name,probe] of Object.entries(current.measurements?.probes??{})) {
    if(name.startsWith('Collection') && (current.measurements?.datasetChanged || previous.measurements?.datasetChanged || current.context?.datasetFingerprint!==previous.context?.datasetFingerprint))continue;
    const before=previous.measurements?.probes[name]?.medianMs;
    if (before && Number.isFinite(before)){
      changes[name]=(probe.medianMs/before-1)*100;
      comparisons[name]={previousId:previous.id,createdAt:previous.createdAt,percent:changes[name]};
    }
  }
  return Object.keys(changes).length?{ previousId:previous.id,changes,comparisons }:null;
}
