import { expect, test } from 'bun:test';
import ts from 'typescript';

/** Execute the production handler bodies against disposable preview-only owners. */
async function handler(file: string, name: string, scope: Record<string, unknown>) {
  const source = await Bun.file(new URL(`../src/lib/ui/components/${file}`, import.meta.url)).text();
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
  const tree = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) expression = node.initializer.getText(tree);
    if (['onMount','beforeNavigate'].includes(name) && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name && node.arguments[0]) expression = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!expression) throw new Error(`Missing production handler ${name}`);
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(`export default ${expression}`).replace('export default', 'return');
  return new Function(...Object.keys(scope), code)(...Object.values(scope)) as (...args: any[]) => any;
}
function forbidden(): never { throw new Error('A live owner was accessed'); }
const live = new Proxy({}, { get: forbidden, set: forbidden });

test('job previews neither poll route settings nor block real navigation with draft guards', async () => {
  await (await handler('JobsSettings.svelte', 'onMount', {preview:true,setInterval:forbidden,invalidate:forbidden}))();
  await (await handler('JobSchedule.svelte', 'beforeNavigate', {preview:true,window:live,busy:true,dirty:true}))({cancel:forbidden,to:{url:new URL('https://coast.example/library')}});
});

test('friend preview invite and join refuse before observing or commanding the real party', async () => {
  for (const name of ['inviteFriend', 'joinParty']) {
    const source = await Bun.file(new URL('../src/lib/ui/components/FriendsPanel.svelte', import.meta.url)).text();
    const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
    const tree = ts.createSourceFile('friends.ts', script, ts.ScriptTarget.Latest, true);
    const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(node.getText(tree));
    const command = new Function('preview', 'syncedPlayer', 'beginPlaybackGesture', 'startSynced', 'joinSynced', `let failure=''; ${code}; return {run:${name}, failure:()=>failure};`)(true, live, forbidden, forbidden, forbidden);
    await command.run('preview-person');
    expect(command.failure()).toContain('disabled');
  }
});

test('closing a preview controller never cancels live preparation or invalidates tracking', async () => {
  const player = { session: { id: 'preview' } as {id:string}|null, role: 'playback', paused: false, subtitlePrompt: true };
  const close = await handler('PersistentPlayer.svelte', 'close', {
    preview: true, player, cancelPlaybackPreparation: forbidden,
    syncedPlayer: live, leaveSynced: forbidden, refreshAfterChange: forbidden,
  });
  await close();
  expect(player).toEqual({ session: null, role: 'idle', paused: true, subtitlePrompt: false });
});

test('preview controller toggles only its local state and skips engine, fullscreen and diagnostics work', async () => {
  const player = { paused: false };
  const scope = { preview: true, player, media: live, syncedPlayer: live, document: live, browserDiagnostic: forbidden };
  await (await handler('PersistentPlayer.svelte', 'toggle', scope))();
  expect(player.paused).toBe(true);
  await (await handler('PersistentPlayer.svelte', 'toggle', scope))();
  expect(player.paused).toBe(false);
  await (await handler('PersistentPlayer.svelte', 'pause', scope))();
  expect(player.paused).toBe(true);
  for (const name of ['switchEdition', 'ended', 'fullscreen', 'tracePlayback']) await (await handler('PersistentPlayer.svelte', name, scope))();
});

test('party menu preview preferences/settings/ready state stay on its disposable room', async () => {
  const preferences = { keepPlaying: true, offsetSeconds: 0 };
  const room = { settings: { readyCheck: false }, participants: [{ userId: 'preview', ready: false }] };
  const scope = {
    preview: true, previewPreferences: preferences, previewRoom: room, userId: 'preview',
    livePreferences: forbidden, liveSettings: forbidden, liveCommand: forbidden,
  };
  await (await handler('PartyMenu.svelte', 'setSyncPreferences', scope))({ keepPlaying: false, offsetSeconds: 1.5 });
  await (await handler('PartyMenu.svelte', 'updatePartySettings', scope))({ readyCheck: true });
  await (await handler('PartyMenu.svelte', 'syncedCommand', scope))('ready', { ready: true });
  expect(preferences).toEqual({ keepPlaying: false, offsetSeconds: 1.5 });
  expect(room.settings.readyCheck).toBe(true);
  expect(room.participants[0].ready).toBe(true);
});
