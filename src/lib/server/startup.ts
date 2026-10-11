import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory, initializeCredentialKey } from './security/credentials';
import { startQueueWorker, stopQueueWorker } from './queue';
import { stopProviderMaintenance } from '$lib/providers/maintenance.server';
import { runtimeEvidence } from './diagnostics/runtime';
import {closeDb} from './db';

type Runtime = { register?: () => void; initialization: Promise<void>; stop: () => void };
const runtimeKey=Symbol.for('coast.platform.runtime');
const processState=globalThis as typeof globalThis & {[runtimeKey]?:Runtime};
const shutdownKey=Symbol.for('coast.platform.shutdown');
const shutdownState=globalThis as typeof globalThis & {[shutdownKey]?: {started: boolean; closing?: Promise<void>}};
const shutdown=shutdownState[shutdownKey]??= {started:false};
export function platformStopping() { return shutdown.started; }
/** The adapter stops HTTP; stop new background work and bound pool draining. */
export function stopPlatform(): Promise<void> {
  shutdown.started=true;
  return shutdown.closing ??= Promise.resolve().then(() => processState[runtimeKey]?.stop()).catch(() => {})
    .then(() => closeDb({timeout:2})).catch(() => {});
}
const onShutdown = () => { void stopPlatform(); };
/** Invoke from the server init hook, never during prerender/build. */
export function initializePlatform(registerHandlers?: () => void): Promise<void> {
  if (platformStopping()) return Promise.reject(new Error('Coast is stopping.'));
  const current=processState[runtimeKey];
  if(current&&current.register===registerHandlers)return current.initialization;
  // SSR reloads must replace the old workers and handlers together, just like the ORM.
  current?.stop();
  const stop=()=>{
    stopQueueWorker();stopProviderMaintenance();
    runtimeEvidence.stop();
    process.off('SIGTERM',onShutdown);process.off('SIGINT',onShutdown);
    process.off('sveltekit:shutdown',onShutdown);
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
    process.once('SIGTERM',onShutdown);process.once('SIGINT',onShutdown);
    process.once('sveltekit:shutdown',onShutdown);
    startQueueWorker();
  })();
  return runtime.initialization;
}
