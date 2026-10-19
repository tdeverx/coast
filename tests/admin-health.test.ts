import {expect,test} from 'bun:test';

const source=await Bun.file(new URL('../src/lib/server/notifications/index.ts',import.meta.url)).text();
const body=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(source.indexOf('export async function systemHealth(')).replace('export ',''));
function health(failAt?:number){
 const calls:string[]=[];let now=100;
 const actions=[{state:'pending',count:3}],connections=[{status:'connected',count:2}];
 const run=new Function('requireAdmin','getSql','Date','process',body+';return systemHealth;')(
  (actor:any)=>{if(actor?.role!=='admin')throw Error('Administrator required');},
  ()=>async(query:TemplateStringsArray)=>{
   calls.push(query[0]);if(calls.length===failAt)throw Error('database failure');
   now+=[7,50,80][calls.length-1];return [[],actions,connections][calls.length-1];
  },{now:()=>now},{uptime:()=>12.9});
 return {run,calls,actions,connections};
}

test('health reports the ping interval while retaining aggregate query order and payload',async()=>{
 const current=health(),result=await current.run({role:'admin'});
 expect(result).toEqual({database:{status:'healthy',latencyMs:7},actions:current.actions,connections:current.connections,uptimeSeconds:12,telemetry:false});
 expect(current.calls).toEqual(['SELECT 1','SELECT state, count(*)::int AS count FROM outbox_actions GROUP BY state','SELECT status, count(*)::int AS count FROM provider_connections GROUP BY status']);
});

test('health still requires an administrator before any database work',async()=>{
 const current=health();await expect(current.run(null)).rejects.toThrow('Administrator required');expect(current.calls).toEqual([]);
});

test('every health query failure still rejects and stops the remaining queries',async()=>{
 for(const failure of [1,2,3]){const current=health(failure);await expect(current.run({role:'admin'})).rejects.toThrow('database failure');expect(current.calls.length).toBe(failure);}
});
