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
  constructor(private directory: () => string = () => join(dataDirectory(), 'diagnostics')) {}
  private async prune(force = false) {
    if (!force && Date.now() - this.lastPrune < 60_000) return;
    this.lastPrune = Date.now();
    for (let i = 0; i < storageLimits.segments; i++) {
      const path = join(this.directory(), `${i}.jsonl`);
      try {
        const file = await stat(path);
        let oldest = file.mtimeMs;
        if (file.size <= storageLimits.segmentBytes) {
          try {
            oldest = Math.min(
              oldest,
              Date.parse(JSON.parse((await readFile(path, 'utf8')).split('\n')[0]).createdAt)
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
      !diagnosticEvents.includes(event) ||
      this.pending >= storageLimits.pending
    )
      return Promise.resolve();
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
    this.pending++;
    this.tail = this.tail
      .then(async () => {
        await mkdir(this.directory(), { recursive: true, mode: 0o700 });
        await chmod(this.directory(), 0o700);
        await this.prune();
        const path = join(this.directory(), '0.jsonl');
        const size = await stat(path)
          .then((s) => s.size)
          .catch(() => 0);
        if (size + Buffer.byteLength(line) > storageLimits.segmentBytes) {
          await unlink(join(this.directory(), `${storageLimits.segments - 1}.jsonl`)).catch(
            (error) => {
              if (error.code !== 'ENOENT') throw error;
            }
          );
          for (let i = storageLimits.segments - 2; i >= 0; i--)
            await rename(
              join(this.directory(), `${i}.jsonl`),
              join(this.directory(), `${i + 1}.jsonl`)
            ).catch((error) => {
              if (error.code !== 'ENOENT') throw error;
            });
        }
        await appendFile(path, line, { mode: 0o600 });
      })
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
    return this.tail;
  }
  async recent() {
    await this.tail;
    await this.prune(true);
    const rows = [];
    for (let i = 0; i < storageLimits.segments; i++) {
      try {
        const path = join(this.directory(), `${i}.jsonl`);
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
                detail: safeFields(row.detail),
              });
          } catch {
            /* truncated line */
          }
        }
      } catch {
        /* Diagnostics must never prevent application use. */
      }
    }
    return rows.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
export const diagnosticStore = new DiagnosticStore();
export const logDiagnostic = diagnosticStore.write.bind(diagnosticStore);
export function classifyFailure(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof TypeError) return 'network';
  return 'unexpected';
}
