// Run with Playwright CLI run-code --filename after a guarded copy/app setup.
// Read-only Library interaction; private session remains inside the browser.
async page=>{
 if(!['127.0.0.1','localhost'].includes(new URL(page.url()).hostname)||new URL(page.url()).port!=='5175')throw Error('Use the isolated audit app on loopback port 5175.');
 const context=await page.context().browser().newContext({storageState:await page.context().storageState(),viewport:{width:1440,height:900}});
 try{
 const p=await context.newPage();await p.goto('http://127.0.0.1:5175/library?view=watch');await p.getByRole('group',{name:'Watch selection',exact:true}).waitFor();const title=await p.locator('main h2').first().textContent();const c=await context.newCDPSession(p);await c.send('Performance.enable');const samples=[];
 for(let n=1;n<=18;n++){
  if(n>1){await p.getByRole('button',{name:'Load more',exact:true}).click();await p.waitForURL(u=>u.searchParams.get('page')===String(n));await p.getByRole('button',{name:'Load more',exact:true}).waitFor();if(await p.locator('main h2').first().textContent()!==title)throw Error('Library count changed while paging.');}
  if([3,6,12,18].includes(n)){await p.waitForTimeout(1500);await c.send('Runtime.discardConsoleEntries');await c.send('Log.clear');await c.send('HeapProfiler.collectGarbage');samples.push({page:n,cards:await p.locator('main article').count(),dom:await c.send('Memory.getDOMCounters'),heapBytes:(await c.send('Performance.getMetrics')).metrics.find(x=>x.name==='JSHeapUsedSize')?.value,images:await p.locator('main img').evaluateAll(xs=>({total:xs.length,decoded:xs.filter(x=>x.complete&&x.naturalWidth>0).length}))});}
 }
 const chunks=[];c.on('HeapProfiler.addHeapSnapshotChunk',x=>chunks.push(x.chunk));await c.send('HeapProfiler.takeHeapSnapshot',{reportProgress:false});const h=JSON.parse(chunks.join('')),nf=h.snapshot.meta.node_fields,N=nf.length,d=nf.indexOf('detachedness'),ni=nf.indexOf('name');let detachedCards=0;for(let n=0;n<h.nodes.length;n+=N)if(h.nodes[n+d]===2&&h.strings[h.nodes[n+ni]].startsWith('<article class="media-card'))detachedCards++;
 if(samples.at(-1).cards!==180||samples.at(-1).dom.nodes>samples[0].dom.nodes*1.25||samples.at(-1).dom.jsEventListeners>samples[0].dom.jsEventListeners*1.25||detachedCards>10)throw Error('Library retention did not meet the bounded diagnostic contract; retain the raw evidence and investigate.');
 return{boundary:'Independent new browser context and page inside a single CLI invocation, avoiding automatic CLI aria snapshots for the probe page; actual Library/admin and retained artwork; record successful/failed artwork policy separately and preserve decoded-image counts',samples,detachedCards};
 }finally{await context.close();}
}
