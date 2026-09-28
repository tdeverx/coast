import { expect, test } from 'bun:test';
import { creditRoles } from '../src/lib/media/credits';

test('cast roles discard blanks and merge repeated voice and non-voice names', () => {
  const roles = creditRoles(
    'Caleb (voice) / Caleb / / Teacher (voice) / Teacher (voice) / IUD (voice) / caleb'
  );
  expect(roles.names).toEqual(['Caleb', 'Teacher', 'IUD']);
  expect(roles.preview).toBe('Caleb, Teacher');
  expect(roles.remaining).toBe(1);
  expect(roles.voice).toBe(true);
  expect(roles.full).toBe('Caleb, Teacher, IUD · Voice');
});
test('mixed credits retain voice annotations in the complete list', () => {
  const roles = creditRoles('Self / Caleb (voice)');
  expect(roles.voice).toBe(false);
  expect(roles.full).toBe('Self, Caleb (voice)');
  expect(roles.remaining).toBe(0);
});
test('empty credits and combined crew jobs normalize without phantom roles', () => {
  expect(creditRoles(' / / ').names).toEqual([]);
  expect(creditRoles(undefined).full).toBe('');
  expect(creditRoles('Director · Writer · Director').names).toEqual(['Director', 'Writer']);
});
