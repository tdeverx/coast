import { expect, test } from 'bun:test';
import { compileRunes, componentScript, moduleUrl } from './fixtures/ui-script';

const userWork = '00000000-0000-4000-8000-000000000091';
const otherWork = '00000000-0000-4000-8000-000000000092';

async function commands(path: string, props: Record<string, unknown>) {
  const calls: { path: string; body: unknown; method: string }[] = [];
  const source = (await componentScript(path)).replace(/\$props\(\)/g, 'properties').replace(/\bexport (?=(?:async )?function)/g, '');
  const factory = await import(moduleUrl(compileRunes(`
    const onDestroy = () => {}, reportFailure = () => {};
    const randomId = () => crypto.randomUUID();
    export function create(properties, deliver) {
      const useClient = () => ({ change: deliver, feedback: { notify() {} } });
      const createMutation = () => ({
        busy: false, error: '',
        async run(task) { return (await task()) !== false; }
      });
      ${source}
      return {
        finish: typeof finish === 'function' ? finish : undefined,
        chooseFinishDate: typeof chooseFinishDate === 'function' ? chooseFinishDate : undefined,
        complete: typeof complete === 'function' ? complete : undefined,
        chooseDate: typeof chooseDate === 'function' ? chooseDate : undefined,
        endReread: typeof endReread === 'function' ? endReread : undefined,
        reset: typeof reset === 'function' ? reset : undefined,
        save: ${path.includes('ReadingCommands') ? 'save' : 'submit'},
        replaceWork(value) { workId = value; },
      };
    }
  `)));
  const owner = factory.create(props, async (path: string, body: unknown, method = 'POST') => {
    calls.push({ path, body, method });
    return {};
  });
  return { owner, calls };
}

test('reading date dialogs retain their exact work and reread cancellation carries its generation', async () => {
  const rereadId = crypto.randomUUID();
  const { owner, calls } = await commands('src/lib/ui/work-menu/ReadingCommands.svelte', {
    workId: userWork, progress: { state: 'reading', page: 12, totalPages: 40, rereadId },
    ensure: async () => ({}), changed: async () => {},
  });
  owner.chooseDate('complete');
  owner.replaceWork(otherWork);
  await owner.save();
  expect(calls[0].path).toBe(`reading/${userWork}/progress`);
  expect(calls[0].body).toMatchObject({ state: 'completed' });
  expect(new Date((calls[0].body as { occurredAt: string }).occurredAt).getTime()).toBeLessThanOrEqual(Date.now());
  await owner.endReread();
  expect(calls[1]).toEqual({
    path: `reading/${otherWork}/progress`, body: { endReread: rereadId }, method: 'POST',
  });
});

test('reading reset confirmations keep their exact target and never reset before confirmation', async () => {
  const { owner, calls } = await commands('src/lib/ui/work-menu/ReadingCommands.svelte', {
    workId: userWork, progress: { state: 'completed', page: 40, totalPages: 40 },
    ensure: async () => ({}), changed: async () => {},
  });
  owner.reset('position');
  expect(calls).toHaveLength(0);
  owner.replaceWork(otherWork);
  await owner.save();
  expect(calls[0]).toEqual({ path: `reading/${userWork}/progress`, body: { reset: 'position' }, method: 'POST' });
  owner.reset('unread');
  expect(calls).toHaveLength(1);
  owner.replaceWork(userWork);
  await owner.save();
  expect(calls[1]).toEqual({ path: `reading/${otherWork}/progress`, body: { reset: 'unread' }, method: 'POST' });
});

test('game date dialogs retain the selected playthrough while changing the surrounding work', async () => {
  const playthroughId = crypto.randomUUID();
  const { owner, calls } = await commands('src/lib/ui/work-menu/GameCommands.svelte', {
    workId: userWork, gameData: { platforms: ['PC'], playthrough: {
      id: playthroughId, status: 'in-progress', progressPercent: 25,
    } }, ensure: async () => ({}), changed: async () => {},
  });
  await owner.chooseFinishDate();
  owner.replaceWork(otherWork);
  await owner.save();
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe(`game-playthroughs/${playthroughId}`);
  expect(calls[0].method).toBe('PATCH');
  expect(calls[0].body).toMatchObject({ status: 'completed' });
  expect(new Date((calls[0].body as { completedAt: string }).completedAt).getTime()).toBeLessThanOrEqual(Date.now());
});
