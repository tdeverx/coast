import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory, initializeCredentialKey } from './security/credentials';
import { startQueueWorker, stopQueueWorker } from './queue';
import { stopProviderMaintenance } from '$lib/providers/maintenance.server';
import { runtimeEvidence } from './diagnostics/runtime';

type Runtime = { register?: () => void; initialization: Promise<void>; stop: () => void };
const runtimeKey=Symbol.for('coast.platform.runtime');
const processState=globalThis as typeof globalThis & {[runtimeKey]?:Runtime};
const stopEvidence = () => runtimeEvidence.stop();
/** Invoke from the server init hook, never during prerender/build. */
export function initializePlatform(registerHandlers?: () => void): Promise<void> {
  const current=processState[runtimeKey];
  if(current&&current.register===registerHandlers)return current.initialization;
  // SSR reloads must replace the old workers and handlers together, just like the ORM.
  current?.stop();
  const stop=()=>{
    stopQueueWorker();stopProviderMaintenance();
    runtimeEvidence.stop();
    process.off('SIGTERM',stopQueueWorker);process.off('SIGINT',stopQueueWorker);
    process.off('SIGTERM',stopEvidence);process.off('SIGINT',stopEvidence);
  };
  const runtime:Runtime={register:registerHandlers,stop,initialization:Promise.resolve()};
  processState[runtimeKey]=runtime;
  runtime.initialization=(async () => {
    for (const directory of ['artwork', 'runtime'])
      await mkdir(join(dataDirectory(), directory), { recursive: true, mode: 0o700 });
    await initializeCredentialKey();
    if(processState[runtimeKey]!==runtime)return;
    registerHandlers?.();
    runtimeEvidence.start();
    process.once('SIGTERM',stopEvidence);process.once('SIGINT',stopEvidence);
    startQueueWorker();
    process.once('SIGTERM', stopQueueWorker);
    process.once('SIGINT', stopQueueWorker);
  })();
  return runtime.initialization;
}
