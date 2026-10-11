import {expect,test} from 'bun:test';

test('shutdown refuses new SQL pools and cached ORM access after draining', async () => {
  // A separate process leaves other tests' shared lifecycle state untouched.
  const source=String.raw`
    import {getSql,getDb,closeDb} from './src/lib/server/db';
    const sql=getSql(), db=getDb();
    globalThis[Symbol.for('coast.platform.shutdown')]={started:true};
    function refused() {
      for(const access of [getSql,getDb]) {
        let refused=false;
        try {access();}catch(error){refused=error.message==='Coast is stopping.';}
        if(!refused)process.exit(7);
      }
    }
    refused();
    await closeDb({timeout:0});
    refused();
  `;
  const child=Bun.spawn([process.execPath,'-e',source],{
    env:{...process.env,DATABASE_URL:'postgres://synthetic@127.0.0.1:65432/synthetic'},stdout:'ignore',stderr:'pipe',
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stderr).text()).toBe('');
});
