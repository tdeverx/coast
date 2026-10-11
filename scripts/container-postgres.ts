import {writeSync} from 'node:fs';
import {RuntimeAudit} from './runtime-audit';

/** Project only known server lifecycle/error categories, never statement text. */
export function databaseEvent(line: string) {
  // Statements/continuation lines must not masquerade as server log levels.
  if (!/^\d{4}-\d{2}-\d{2}[ T].*?\[\d+\]\s+(?:LOG|FATAL|PANIC):/.test(line)) return;
  if (/PANIC:.*Structure needs cleaning/.test(line)) return {kind: 'database.failed' as const, code: 'storage-corrupt'};
  if (/PANIC:/.test(line)) return {kind: 'database.failed' as const, code: 'panic'};
  if (/FATAL:.*sorry, too many clients already/.test(line)) return {kind: 'database.failed' as const, code: 'connection-limit'};
  if (/LOG:.*database system is ready to accept connections/.test(line)) return {kind: 'database.ready' as const};
  if (/LOG:.*received (?:smart|fast|immediate) shutdown request/.test(line)) return {kind: 'database.shutdown' as const, code: 'shutdown-start'};
  if (/LOG:.*database system is shut down/.test(line)) return {kind: 'database.shutdown' as const, code: 'shutdown-complete'};
}

export async function runPostgres(directory: string, command: string[]) {
  if (!directory || !command.length) throw Error('Pass data directory and PostgreSQL command.');
  const audit = new RuntimeAudit(directory, undefined, 'database-events');
  const metadata = {bunVersion: Bun.version,
    postgresVersion: process.env.COAST_POSTGRES_VERSION?.match(/^postgres \(PostgreSQL\) (\d+\.\d+(?:\.\d+)?)/)?.[1] || 'unknown'};
  const child = Bun.spawn(command, {stdin: 'ignore', stdout: 'inherit', stderr: 'pipe'});
  const terminate = () => child.kill('SIGTERM'), interrupt = () => child.kill('SIGINT');
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
  void audit.write('database.start', {...metadata, pid: child.pid});
  const decoder = new TextDecoder();
  let buffer = '', oversized = false, failures = 0, window = performance.now();
  const record = (line: string) => {
    const event = databaseEvent(line);
    if (!event) return;
    const now = performance.now();
    if (now - window >= 60_000) {window = now; failures = 0;}
    // Failure storms cannot rotate start/exit/migration evidence immediately.
    if (event.kind === 'database.failed' && failures++ >= 2) return;
    void audit.write(event.kind, {...metadata, pid: child.pid, code: event.code});
  };
  const reader = child.stderr.getReader();
  try {
    while (true) {
      const {done, value: bytes} = await reader.read();
      if (done) break;
      // Console behavior is retained; only the independent audit is redacted.
      try {writeSync(2, bytes);} catch { /* Disconnected console. */ }
      const text = decoder.decode(bytes, {stream: true});
      let offset = 0;
      while (offset < text.length) {
        const next = text.indexOf('\n', offset), end = next === -1 ? text.length : next;
        if (!oversized) {
          if (buffer.length + end - offset > 4096) {buffer = ''; oversized = true;}
          else buffer += text.slice(offset, end);
        }
        if (next !== -1) {if (!oversized) record(buffer); buffer = ''; oversized = false;}
        offset = end + 1;
      }
    }
    if (buffer && !oversized) record(buffer);
    const status = await child.exited;
    await audit.write('database.exit', {...metadata, pid: child.pid, exitCode: status});
    return status;
  } finally {reader.releaseLock(); process.off('SIGTERM', terminate); process.off('SIGINT', interrupt);}
}

if (import.meta.main) {
  const [directory, ...command] = process.argv.slice(2);
  process.exitCode = await runPostgres(directory, command);
}
