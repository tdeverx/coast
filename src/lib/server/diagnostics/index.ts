import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, stat, rename, unlink, appendFile, readFile, chmod } from 'node:fs/promises';
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
  segments: 4,
  retentionMs: 7 * 86400_000,
  pending: 128,
};
export class DiagnosticStore {
  level: DiagnosticLevel = 'info';
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private lastPrune = 0;
  private dropped = 0;
  private failures = 0;
  metrics() { return {diagnosticPending: this.pending, diagnosticDropped: this.dropped, diagnosticFailures: this.failures}; }
  constructor(private directory: () => string = () => join(dataDirectory(), 'diagnostics'), private maxLineBytes = storageLimits.segmentBytes) {}
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
    for (let i = 0; i < storageLimits.segments; i++) {
      const path = join(directory, `${i}.jsonl`);
      try {
        const file = await stat(path);
        let oldest = file.mtimeMs;
        if (file.size <= storageLimits.segmentBytes) {
          try {
            const contents = await readFile(path, 'utf8');
            const boundary = contents.indexOf('\n');
            oldest = Math.min(
              oldest,
              Date.parse(JSON.parse(boundary < 0 ? contents : contents.slice(0, boundary)).createdAt)
            );
          } catch {
            /* Not a complete event. */
          }
        }
        if (Date.now() - oldest > storageLimits.retentionMs) await unlink(path);
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
          await unlink(join(directory, `${storageLimits.segments - 1}.jsonl`)).catch(
            (error) => {
              if (error.code !== 'ENOENT') throw error;
            }
          );
          for (let i = storageLimits.segments - 2; i >= 0; i--)
            await rename(
              join(directory, `${i}.jsonl`),
              join(directory, `${i + 1}.jsonl`)
            ).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
            });
        }
        await appendFile(path, line, { mode: 0o600 });
      })
      .catch(() => { this.failures++; })
      .finally(() => {
        this.pending--;
      });
    return this.tail;
  }
  async recent(limit = Infinity) {
    limit = Math.max(0, Math.trunc(limit) || 0);
    await this.tail;
    const directory = this.directory();
    await this.prune(directory, true);
    const rows = [];
    for (let i = 0; i < storageLimits.segments; i++) {
      try {
        const path = join(directory, `${i}.jsonl`);
        if ((await stat(path)).size > storageLimits.segmentBytes) continue;
        const lines = (await readFile(path, 'utf8')).trim().split('\n');
        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            if (
              Date.now() - Date.parse(row.createdAt) <= storageLimits.retentionMs &&
              diagnosticEvents.includes(row.kind) &&
              diagnosticLevels.includes(row.level)
            )
              rows.push({
                createdAt: new Date(row.createdAt).toISOString(),
                level: row.level,
                kind: row.kind,
                message: eventMessages[row.kind as DiagnosticEvent],
                correlationId: correlationId(row.correlationId),
                detail: row.detail,
              });
          } catch {
            /* truncated line */
          }
        }
      } catch {
        /* Diagnostics must never prevent application use. */
      }
    }
    const recent = [];
    for (const row of rows.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (recent.length >= limit) break;
      try {
        // Sanitize only admitted output, but keep looking if malformed fields
        // reject a record. Sorting and equal-time occurrence order stay exact.
        recent.push({ ...row, detail: safeFields(row.detail) });
      } catch {
        /* Invalid diagnostic detail must not hide the next eligible record. */
      }
    }
    return recent;
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
