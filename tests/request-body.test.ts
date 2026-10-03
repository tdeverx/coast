import { test, expect } from 'bun:test';
import { readJsonBody } from '../src/lib/server/security/request-body';
const request = (body?: BodyInit, type = 'application/json') => new Request('http://fixture.test', { method: 'POST', headers: { 'content-type': type }, body });
test('JSON request reader accepts objects with a charset and rejects other JSON shapes', async () => {
  expect(await readJsonBody(request('{"value":true}', 'Application/JSON; charset=utf-8'))).toEqual({ value: true });
  for (const body of ['[]', 'null', 'false', '"text"', '{']) await expect(readJsonBody(request(body))).rejects.toMatchObject({ status: 400 });
  await expect(readJsonBody(request('{}', 'application/jsonp'))).rejects.toMatchObject({ status: 415 });
});
test('JSON request reader enforces the limit while streaming without trusting Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"value":"')); controller.enqueue(new TextEncoder().encode('oversize"}')); controller.close(); } });
  await expect(readJsonBody(request(stream), 12)).rejects.toMatchObject({ status: 413 });
});
test('empty input is explicit and malformed UTF-8 is rejected', async () => {
  expect(await readJsonBody(request())).toEqual({});
  await expect(readJsonBody(request(), 65536, false)).rejects.toMatchObject({ status: 400 });
  await expect(readJsonBody(request(new Uint8Array([123,34,120,34,58,34,255,34,125])))).rejects.toMatchObject({ status: 400 });
});
