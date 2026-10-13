import {RuntimeAudit} from './runtime-audit';
const [directory, stage, child, signal, status] = process.argv.slice(2);
await new RuntimeAudit(directory, undefined, 'shutdown-events').write('supervisor.shutdown', {
  stage, child, signal, exitCode: Number(status), build: process.env.COAST_BUILD_ID || 'unknown', bunVersion: Bun.version,
});
