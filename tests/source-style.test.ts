import { expect, test } from 'bun:test';
import { compoundStatementLines } from '../scripts/source-style';

test('source style exposes collapsed control flow without reading SQL or for headers as statements', () => {
  expect(compoundStatementLines('function run() { begin(); if (ready) finish(); return result; }')).toEqual([1]);
  expect(compoundStatementLines('const first = 1; const second = 2;')).toEqual([1]);
  expect(compoundStatementLines('switch (state) { case 1: begin(); break; default: finish(); break; }')).toEqual([1]);
  expect(compoundStatementLines(`
const query = sql\`select 1; select 2;\`;
for (let index = 0; index < 2; index++) {
  process(index);
  finish(index);
}
// begin(); finish();
`)).toEqual([]);
});
