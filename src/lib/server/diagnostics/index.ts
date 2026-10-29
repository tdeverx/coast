import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, stat, rename, unlink, appendFile, readFile, chmod, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory } from '../security/credentials';
import {
  diagnosticEvents,
  eventMessages,
  diagnosticLevels,
  enabled,
  safeFields,
  correlationId,
  type DiagnosticLevel,
  type DiagnosticEvent,
} from '../../diagnostics';

export const context = new AsyncLocalStorage<string>();
export const storageLimits = {
  segmentBytes: 1024 * 1024,
  segments: 256,
  retentionMs: 7 * 86400_000,
  pending: 128,
};
type DiagnosticRow = {createdAt: string; level: DiagnosticLevel; kind: DiagnosticEvent; message: string; correlationId: string | undefined; detail: ReturnType<typeof safeFields>};
export type DiagnosticRetention = { maxSizeMiB: number; maxAgeDays: number };
export class DiagnosticStore {
  retention: DiagnosticRetention = { maxSizeMiB: storageLimits.segments, maxAgeDays: 7 };
  configure(retention: DiagnosticRetention) {
    if (retention.maxSizeMiB !== this.retention.maxSizeMiB || retention.maxAgeDays !== this.retention.maxAgeDays) this.lastPrune = 0;
    this.retention = { ...retention };
  }
  level: DiagnosticLevel = 'info';
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private lastPrune = 0;
  private dropped = 0;
  private failures = 0;
  metrics() { return {diagnosticPending: this.pending, diagnosticDropped: this.dropped, diagnosticFailures: this.failures}; }
  constructor(private directory: () => string = () => join(dataDirectory(), 'diagnostics'), private maxLineBytes = storageLimits.segmentBytes) {}
  private async files(directory: string) {
    return (await readdir(directory).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [] as string[];
    }))
      .filter(name => /^(0|[1-9]\d*)\.jsonl$/.test(name))
      .sort((a, b) => Number(a.slice(0, -6)) - Number(b.slice(0, -6)));
  }
  private async prepare(directory: string) {
    try {
      const file = await stat(directory);
      if (!file.isDirectory()) throw new Error('Diagnostic storage is not a directory.');
      if ((file.mode & 0o7777) !== 0o700) await chmod(directory, 0o700);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
  }
  private async prune(directory: string, force = false) {
    if (!force && Date.now() - this.lastPrune < 60_000) return;
    this.lastPrune = Date.now();
    for (const name of await this.files(directory)) {
      const index = Number(name.slice(0, -6));
      const path = join(directory, name);
      try {
        if (index >= this.retention.maxSizeMiB) { await unlink(path); continue; }
        const file = await stat(path);
        let oldest = file.mtimeMs;
        if (file.size <= storageLimits.segmentBytes) {
          try {
            const handle = await open(path, 'r');
            try {
              // Age checks need only the first event, not the entire storage budget.
              const buffer = Buffer.alloc(4096);
              const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
              const contents = buffer.toString('utf8', 0, bytesRead);
              const boundary = contents.indexOf('\n');
              const createdAt = Date.parse(JSON.parse(boundary < 0 ? contents : contents.slice(0, boundary)).createdAt);
              if (Number.isFinite(createdAt)) oldest = Math.min(oldest, createdAt);
            } finally { await handle.close(); }
          } catch {
            /* Not a complete event. */
          }
        }
        if (Date.now() - oldest > this.retention.maxAgeDays * 86400_000) await unlink(path);
      } catch {
        /* absent or inaccessible */
      }
    }
  }
  write(
    level: DiagnosticLevel,
    event: DiagnosticEvent,
    fields: Record<string, unknown> = {},
    id = context.getStore()
  ) {
    if (
      !enabled(level, this.level) ||
      !diagnosticEvents.includes(event)
    )
      return Promise.resolve();
    if (this.pending >= storageLimits.pending) { this.dropped++; return Promise.resolve(); }
    let line: string;
    try {
      line =
        JSON.stringify({
          createdAt: new Date().toISOString(),
          level,
          kind: event,
          message: eventMessages[event],
          correlationId: correlationId(id),
          detail: safeFields(fields),
        }) + '\n';
    } catch {
      return Promise.resolve();
    }
    if (Buffer.byteLength(line) > this.maxLineBytes) {this.dropped++; return Promise.resolve();}
    this.pending++;
    this.tail = this.tail
      .then(async () => {
        const directory = this.directory();
        await this.prepare(directory);
        await this.prune(directory);
        const path = join(directory, '0.jsonl');
        const size = await stat(path)
          .then((s) => s.size)
          .catch((error) => {
            if (error.code !== 'ENOENT') throw error;
            return 0;
          });
        if (size + Buffer.byteLength(line) > storageLimits.segmentBytes) {
          for (const name of (await this.files(directory)).reverse()) {
            const index = Number(name.slice(0, -6));
            await (index >= this.retention.maxSizeMiB - 1
              ? unlink(join(directory, name))
              : rename(join(directory, name), join(directory, `${index + 1}.jsonl`))
            ).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
            });
          }
        }
        await appendFile(path, line, { mode: 0o600 });
      })
      .catch(() => { this.failures++; })
      .finally(() => {
        this.pending--;
      });
    return this.tail;
  }
  private async *segments() {
    await this.tail;
    const directory = this.directory();
    let names: string[];
    try {
      await this.prune(directory, true);
      names = await this.files(directory);
    } catch { return; /* Unavailable diagnostics must not break the Activity page. */ }
    for (const name of names) {
      if (Number(name.slice(0, -6)) >= this.retention.maxSizeMiB) continue;
      const rows: DiagnosticRow[] = [];
      try {
        const path = join(directory, name);
        if ((await stat(path)).size > storageLimits.segmentBytes) continue;
        const lines = (await readFile(path, 'utf8')).trim().split('\n');
        for (const line of lines.reverse()) {
          try {
            const row = JSON.parse(line);
            if (
              Date.now() - Date.parse(row.createdAt) <= this.retention.maxAgeDays * 86400_000 &&
              diagnosticEvents.includes(row.kind) &&
              diagnosticLevels.includes(row.level)
            ) rows.push({
              createdAt: new Date(row.createdAt).toISOString(),
              level: row.level,
              kind: row.kind,
              message: eventMessages[row.kind as DiagnosticEvent],
              correlationId: correlationId(row.correlationId),
              detail: safeFields(row.detail),
            });
          } catch { /* Invalid records must not hide the next eligible event. */ }
        }
      } catch { /* Diagnostics must never prevent application use. */ }
      yield rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }
  async recent(limit = Infinity) {
    limit = Math.max(0, Math.trunc(limit) || 0);
    // Keep only the requested tail while reading at most one 1 MiB segment at a time.
    let rows: DiagnosticRow[] = [];
    for await (const segment of this.segments()) {
      rows = rows.concat(segment).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    }
    return rows;
  }
  async *download() {
    // Stream exports so a larger disk budget does not require loading it all into memory.
    for await (const segment of this.segments()) {
      if (segment.length) yield segment.map(row => JSON.stringify(row) + '\n').join('');
    }
  }
}
export const diagnosticStore = new DiagnosticStore();
export const logDiagnostic = diagnosticStore.write.bind(diagnosticStore);
export function classifyFailure(error: unknown) {
  if (error instanceof Error && error.name === 'ProviderQueueBusyError') return 'local-busy';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof TypeError) return 'network';
  return 'unexpected';
}
