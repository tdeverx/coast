// Separate private dev process. Never start this worker from Coast's normal scheduler.
import {setTimeout as delay} from 'node:timers/promises';
import {closeDb} from '../src/lib/server/db';
import {prepareTastePreview,runTastePreviewWorker} from '../src/lib/social/taste-preview-worker.server';
import {tastePreviewUser} from '../src/lib/social/taste-preview-access.server';

const user=process.env.COAST_TASTE_PREVIEW_USER;
if (!user || !tastePreviewUser(user)) throw Error('Set COAST_TASTE_PREVIEW_USER and COAST_TASTE_PREVIEW_DATABASE for the local copy.');
const watch=process.argv.includes('--watch');
let force=process.argv.includes('--rebuild');
let nextPublicationCheck=0;
const stop=new AbortController();
process.once('SIGTERM',()=>stop.abort());
process.once('SIGINT',()=>stop.abort());
try {
  await prepareTastePreview(user);
  do {
    try {
      const checkPublication=Date.now()>=nextPublicationCheck;
      const outcome=await runTastePreviewWorker(user,force,checkPublication);
      if (checkPublication) nextPublicationCheck=Date.now()+15000;
      force=false;
      if (!watch || outcome.published || outcome.completed) console.log(JSON.stringify(outcome));
      if (!watch || stop.signal.aborted) break;
      if (outcome.completed) continue;
    } catch(error) {
      if (!watch) throw error;
      console.error('Taste preview refresh failed:', error instanceof Error?error.message:'Unknown error');
    }
    await delay(2500,undefined,{signal:stop.signal}).catch(error=>{if (!stop.signal.aborted) throw error;});
  } while(!stop.signal.aborted);
} finally { await closeDb(); }
