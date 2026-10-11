import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DiagnosticStore, diagnosticStore, logDiagnostic } from './index';
import { dataDirectory } from '../security/credentials';

// Resource history has its own quota; provider/job chatter cannot rotate it out.
export const runtimeSampleStore = new DiagnosticStore(() => join(dataDirectory(), 'runtime', 'samples'), 4096);
function persist(event: 'runtime.sample' | 'runtime.operation', fields: Record<string, unknown>) {
  if (event !== 'runtime.sample') return logDiagnostic(fields.failed === true ? 'error' : 'info', event, fields);
  runtimeSampleStore.level = diagnosticStore.level;
  return runtimeSampleStore.write('info', event, fields);
}

export const runtimeStages = ['reserve', 'reservation', 'queue', 'heartbeat', 'maintenance'] as const;
export type RuntimeStage = (typeof runtimeStages)[number];
const databaseCodes = ['ERR_POSTGRES_CONNECTION_CLOSED', 'ERR_POSTGRES_CONNECTION_TIMEOUT',
  'ERR_POSTGRES_IDLE_TIMEOUT', 'ERR_POSTGRES_COMMIT_ROLLED_BACK', '53300', '57014', '57P01', '57P02', '57P03'] as const;
/** Error text, SQL, parameters and provider identities never enter these events. */
export function runtimeErrorCode(error: unknown): string {
  try {
    if (!error || typeof error !== 'object') return 'unknown';
    for (const code of [(error as {code?: unknown}).code, (error as {errno?: unknown}).errno])
      if (databaseCodes.includes(code as typeof databaseCodes[number])) return String(code);
    return 'unknown';
  } catch { return 'unknown'; }
}
type Measurements = Record<string, number>;
type Sink = (event: 'runtime.sample' | 'runtime.operation', fields: Record<string, unknown>) => unknown;

async function resources(): Promise<Measurements> {
  const memory = process.memoryUsage(), cpu = process.cpuUsage();
  const result: Measurements = {pid: process.pid, uptimeMs: process.uptime() * 1000, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000};
  // Fixed kernel paths only; these reads do not touch application data or secrets.
  if (process.platform === 'linux') {
    const [current, maximum, events, stat] = await Promise.all([
      readFile('/sys/fs/cgroup/memory.current', 'utf8').catch(() => ''),
      readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => ''),
      readFile('/sys/fs/cgroup/memory.events', 'utf8').catch(() => ''),
      readFile('/sys/fs/cgroup/memory.stat', 'utf8').catch(() => ''),
    ]);
    if (current.trim()) result.cgroupBytes = Number(current.trim());
    if (maximum.trim() && maximum.trim() !== 'max') result.cgroupLimitBytes = Number(maximum.trim());
    const values = Object.fromEntries((events + '\n' + stat).trim().split('\n').map(line => line.split(/\s+/)));
    for (const [key, source] of [['cgroupOom', 'oom'], ['cgroupOomKills', 'oom_kill'],
      ['cgroupAnonBytes', 'anon'], ['cgroupFileBytes', 'file']] as const)
      if (values[source] !== undefined) result[key] = Number(values[source]);
  }
  return result;
}

/** Counters have constant storage; even stalled heartbeats do not grow an ID map. */
export class RuntimeEvidence {
  private active = Object.fromEntries(runtimeStages.map(stage => [stage, 0])) as Record<RuntimeStage, number>;
  private since = Object.fromEntries(runtimeStages.map(stage => [stage, 0])) as Record<RuntimeStage, number>;
  private counters: Measurements = {connectionsOpened: 0, connectionsClosed: 0, connectionFailures: 0,
    heartbeatOverlap: 0, maintenanceOverlap: 0, operationFailures: 0, runtimeEventsDropped: 0};
  private window = 0;
  private events = {timing: 0, error: 0};
  private sampling = false;
  private sampledAt = -Infinity;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private sink: Sink = persist,
    private snapshot: () => Promise<Measurements> = resources,
    private clock: () => number = () => performance.now()) {}
  private emit(event: 'runtime.sample' | 'runtime.operation', fields: Record<string, unknown>) {
    try { void Promise.resolve(this.sink(event, fields)).catch(() => {}); } catch { /* best effort */ }
  }
  private operation(fields: Record<string, unknown>) {
    const now = this.clock();
    if (now - this.window >= 60_000) { this.window = now; this.events = {timing: 0, error: 0}; }
    const budget = fields.failed === true ? 'error' : 'timing';
    // Timing chatter cannot consume the separate failure-event budget.
    if (this.events[budget] >= 30) { this.counters.runtimeEventsDropped++; return; }
    this.events[budget]++;
    this.emit('runtime.operation', fields);
  }
  begin(stage: RuntimeStage): (error?: unknown, failed?: boolean) => void {
    const started = this.clock();
    if (!this.active[stage]) this.since[stage] = started;
    else if (stage === 'heartbeat' || stage === 'maintenance') this.counters[`${stage}Overlap`]++;
    this.active[stage]++;
    let ended = false;
    return (error, failed = error !== undefined) => {
      if (ended) return;
      ended = true;
      this.active[stage] = Math.max(0, this.active[stage] - 1);
      if (!this.active[stage]) this.since[stage] = 0;
      const durationMs = Math.max(0, this.clock() - started);
      if (failed) this.counters.operationFailures++;
      if (failed || durationMs >= 1000)
        this.operation({stage, durationMs, errorCode: runtimeErrorCode(error), failed});
    };
  }
  connection(error: unknown, closed = false) {
    if (closed) this.counters.connectionsClosed++;
    else if (error == null) this.counters.connectionsOpened++;
    if (error != null) this.counters.connectionFailures++;
    if (error != null) this.operation({stage: 'connection', errorCode: runtimeErrorCode(error), failed: true});
  }
  async track<T>(stage: RuntimeStage, work: () => PromiseLike<T>): Promise<T> {
    const finish = this.begin(stage);
    try { const result = await work(); finish(); return result; }
    catch (error) { finish(error, true); throw error; }
  }
  measurements(): Measurements {
    const values = {...this.counters};
    for (const stage of runtimeStages) {
      values[`${stage}InFlight`] = this.active[stage];
      // Age of the continuous busy period, not exact oldest-operation age.
      values[`${stage}BusyMs`] = this.active[stage] ? Math.max(0, this.clock() - this.since[stage]) : 0;
    }
    return values;
  }
  async sample() {
    if (this.sampling || this.clock() - this.sampledAt < 60_000) return;
    this.sampling = true;
    this.sampledAt = this.clock();
    try { this.emit('runtime.sample', {bunVersion: Bun.version, ...await this.snapshot(), ...this.measurements(), ...diagnosticStore.metrics()}); }
    catch { this.operation({stage: 'runtime', errorCode: 'unknown', failed: true}); }
    finally { this.sampling = false; }
  }
  start() {
    if (this.timer) return;
    this.operation({stage: 'runtime', phase: 'start', failed: false});
    void this.sample();
    this.timer = setInterval(() => { void this.sample(); }, 60_000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.timer) this.operation({stage: 'runtime', phase: 'stop', failed: false});
    this.timer = undefined;
  }
}
const key = Symbol.for('coast.runtime.evidence');
const shared = globalThis as typeof globalThis & {[key]?: RuntimeEvidence};
export const runtimeEvidence = shared[key] ??= new RuntimeEvidence();
