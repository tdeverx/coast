import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from '@playwright/test';
import {closeDb,getSql} from '../../../src/lib/server/db';
import {previewContext} from '../../../src/lib/social/taste-preview.server';
const [origin,storageState]=process.argv.slice(2);
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname) && storageState,'Pass the private loopback preview and its signed-in browser state.');
const viewer=process.env.COAST_TASTE_PREVIEW_USER;
assert(viewer,'Choose the private copy owner.');
await previewContext(viewer);
const sql=getSql(),browser=await chromium.launch();
const context=await browser.newContext({storageState,viewport:{width:1440,height:900}});
const page=await context.newPage(),problems:string[]=[],responses:{status:number;when:number}[]=[];
page.on('pageerror',e=>problems.push(e.name));
page.on('response',r=>{if(r.url().includes('/profile/card-taste'))responses.push({status:r.status(),when:Date.now()});});
const stats=()=>page.locator('article.media-card').first().evaluate(card=>{
  let node:HTMLElement|null=card.parentElement;
  while(node && !(/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight>node.clientHeight+20))node=node.parentElement;
  const scroller=node??document.scrollingElement!;
  const inView=Array.from(document.querySelectorAll('article.media-card')).filter(a=>{const r=a.getBoundingClientRect();return r.left<innerWidth && r.right>0 && r.bottom>0 && r.top<innerHeight;});
  return {offset:scroller.scrollTop,valid:inView.length,badges:inView.filter(card=>card.querySelector('.taste-match button')).length};
});
let worker:ReturnType<typeof Bun.spawn>|undefined;
try{
  await page.goto(origin+'/library?tasteModel=candidate',{waitUntil:'domcontentloaded'});
  await page.locator('article.media-card .taste-match button').first().waitFor({timeout:60000});
  const before=await stats(),prior=await sql`select epoch from coast_taste_preview.profiles where user_id=${viewer} and medium='movie'`;
  const workerUrl=new URL(process.env.DATABASE_URL!);
  const marker='taste-scroll-'+crypto.randomUUID().slice(0,12);
  workerUrl.searchParams.set('application_name',marker);
  const start=Date.now();
  worker=Bun.spawn([process.execPath,'scripts/taste-preview-worker.ts','--rebuild'],{
    env:{...process.env,DATABASE_URL:workerUrl.href},stdout:'pipe',stderr:'inherit'});
  let ended=0;
  const exited=worker.exited.then(code=>{ended=Date.now();return code;});
  const deadline=start+12000;
  let observed=false;
  while(!observed && Date.now()<deadline && worker.exitCode===null){
    const [row]=await sql`select exists(select from pg_stat_activity a join pg_locks l on a.pid=l.pid
      where a.application_name=${marker} and a.datname=current_database() and l.locktype='advisory' and l.granted) as locked`;
    observed=row.locked;
    if(!observed)await delay(30);
  }
  assert(observed,'Did not observe the actual rebuild lock; repeat if another worker holds it.');
  const lockedAt=Date.now(),samples=[];
  await page.evaluate(()=>{
    const frames:number[]=[];
    let last=0,handle=0;
    const frame=(stamp:number)=>{if(last)frames.push(stamp-last);last=stamp;handle=requestAnimationFrame(frame);};
    handle=requestAnimationFrame(frame);
    Object.assign(window,{finishTasteScrollFrames:()=>{
      cancelAnimationFrame(handle);frames.sort((a,b)=>a-b);
      return {count:frames.length,p50:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1)};
    }});
  });
  await page.mouse.move(820,670);
  for(let index=0;index<28 && worker.exitCode===null;index++){
    await page.mouse.wheel(0,index<12?280:-210);
    await delay(100);
    if(worker.exitCode===null)samples.push(await stats());
  }
  const frames=await page.evaluate(()=>(window as unknown as {finishTasteScrollFrames:()=>unknown}).finishTasteScrollFrames());
  const exit=await exited;
  const outcome=JSON.parse((await new Response(worker.stdout as ReadableStream).text()).trim());
  const after=await sql`select epoch from coast_taste_preview.profiles where user_id=${viewer} and medium='movie'`;
  assert(exit===0&&outcome.published===true&&prior[0].epoch!==after[0].epoch);
  const peakWorkerMiB=Number(((worker.resourceUsage()?.maxRSS??0)/1024/1024).toFixed(2));
  const settled=await stats();
  const responsesDuring=responses.filter(r=>r.when>=lockedAt && r.when<=ended);
  assert(samples.length>=2 && samples.every(s=>s.valid>0),'No visible media during rebuild.');
  assert(Math.max(...samples.map(s=>s.offset))>before.offset+200,'Foreground did not scroll during rebuild.');
  assert(!problems.length && !responses.some(r=>r.status>=400),'The page or a score request failed.');
  console.log(JSON.stringify({rebuildMs:ended-start,observedMs:ended-lockedAt,peakWorkerMiB,frameIntervalsMs:frames,samples:samples.length,before,maxOffset:Math.max(...samples.map(s=>s.offset)),
    minVisible:Math.min(...samples.map(s=>s.valid)),maxBadges:Math.max(...samples.map(s=>s.badges)),settled,
    completedScoreReadsDuring:responsesDuring.length,failedReads:responses.filter(r=>r.status>=400).length,pageErrors:problems.length}));
}finally{if(worker?.exitCode===null)await worker.exited;await browser.close();await closeDb();}
