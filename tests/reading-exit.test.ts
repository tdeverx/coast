import { expect, test } from 'bun:test';
import { compileRunes, moduleUrl } from './fixtures/ui-script';
const source = (await Bun.file('src/lib/reading/client.svelte.ts').text()).replace(/^import .*$/gm, '').replace(/^export /gm, '');
const code = compileRunes(`export function create(api){const refreshAfterChange=async()=>{},message=error=>error.message,isFeatureDisabled=()=>false;class ApiError extends Error{};${source};return {reader,setReadingExit,hideReading,closeReading};}`);
const { create } = await import(moduleUrl(code));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function opened(api: (path: string) => Promise<void> = async () => {}) {
    const owner = create(api);
    owner.reader.session = { id: 'original' };
    owner.reader.visible = true;
    return owner;
}
test('ordinary close keeps the reader alive for its exit, then retires it', async () => {
    const transition = deferred(), calls: string[] = [], owner = opened(async (path: string) => { calls.push(path); });
    owner.setReadingExit(() => transition.promise);
    const closing = owner.closeReading();
    await Promise.resolve();
    expect(owner.reader.visible).toBe(true);
    expect(calls).toEqual([]);
    transition.resolve();
    await closing;
    expect(owner.reader.session).toBeNull();
    expect(calls).toEqual(['reading/sessions/original/close']);
});
test('minimize waits for exit without retiring the reading session', async () => {
    const transition = deferred(), owner = opened();
    owner.setReadingExit(() => transition.promise);
    const hiding = owner.hideReading();
    expect(owner.reader.visible).toBe(true);
    transition.resolve();
    await hiding;
    expect(owner.reader.visible).toBe(false);
    expect(owner.reader.session.id).toBe('original');
});
test('revocation bypasses animation and a superseded exit cannot clear the replacement', async () => {
    const transition = deferred(), owner = opened();
    owner.setReadingExit(() => transition.promise);
    const closing = owner.closeReading();
    await Promise.resolve();
    await owner.closeReading(true, false);
    owner.reader.session = { id: 'replacement' };
    owner.reader.visible = true;
    transition.resolve();
    await closing;
    expect(owner.reader.session.id).toBe('replacement');
    expect(owner.reader.visible).toBe(true);
});
test('failed bookmark saves preserve the visible reader without animating away', async () => {
    const owner = opened(async () => { throw Error('save failed'); });
    owner.reader.location = { format: 'cbz', page: 4, total: 10 };
    let exits = 0;
    owner.setReadingExit(async () => { exits++; });
    await expect(owner.closeReading()).rejects.toThrow('Bookmark could not be saved');
    expect(owner.reader.visible).toBe(true);
    expect(exits).toBe(0);
});
