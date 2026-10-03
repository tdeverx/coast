import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { serverBuildIdentity } from '../src/lib/server/build-identity';

// Lifecycle diagnostics must survive replaceable stdout without retaining any
// URLs, credentials, query parameters or arbitrary child output.
const [directory, child, pid, code, terminationSignal] = process.argv.slice(2);
try {
  const path = `${directory}/runtime/child-exits.jsonl`;
  await mkdir(`${directory}/runtime`, { recursive: true, mode: 0o700 });
  if ((await stat(path).catch(()=>({size:0}))).size > 65536) await rename(path,path+'.1');
  const named=process.env.COAST_BUILD_ID;
  const source=Bun.file('/app/build/server/index.js');
  const build=named && /^[a-zA-Z0-9._-]{1,100}$/.test(named) && named!=='unknown'?named:
    await source.exists()?await serverBuildIdentity('/app/build').catch(()=>'unknown'):'unknown';
  const exitCode=Number(code), signalNumber=exitCode>128&&exitCode<193?exitCode-128:null;
  await appendFile(path,JSON.stringify({createdAt:new Date().toISOString(),child,pid:Number(pid)||null,
    exitCode,signalNumber,terminationSignal:['TERM','INT'].includes(terminationSignal)?terminationSignal:null,build})+'\n',{mode:0o600});
} catch { /* A diagnostic write must never prevent shutdown. */ }
