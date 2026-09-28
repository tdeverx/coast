import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory, initializeCredentialKey } from './security/credentials';
import { initializeRecovery } from './auth/recovery';
import { startQueueWorker, stopQueueWorker } from './queue';

let initialization: Promise<void> | undefined;
/** Invoke from the server init hook, never during prerender/build. */
export function initializePlatform(registerHandlers?: () => void): Promise<void> {
  return (initialization ??= (async () => {
    for (const directory of ['artwork', 'runtime'])
      await mkdir(join(dataDirectory(), directory), { recursive: true, mode: 0o700 });
    await initializeCredentialKey();
    await initializeRecovery();
    registerHandlers?.();
    startQueueWorker();
    process.once('SIGTERM', stopQueueWorker);
    process.once('SIGINT', stopQueueWorker);
  })());
}
