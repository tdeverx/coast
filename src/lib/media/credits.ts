/** Normalize provider credit strings without changing the original metadata. */
export function creditRoles(value: string | null | undefined) {
  const roles = new Map<string, { name: string; voice: boolean }>();
  for (const part of (value ?? '').split(/\s*\/\s*|\s+·\s+/)) {
    const voice = /\(voice\)/i.test(part);
    const name = part
      .replace(/\s*\(voice\)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const previous = roles.get(key);
    if (previous) previous.voice ||= voice;
    else roles.set(key, { name, voice });
  }
  const unique = [...roles.values()];
  const voice = unique.length > 0 && unique.every((role) => role.voice);
  const names = unique.map((role) => role.name);
  return {
    names,
    voice,
    preview: names.slice(0, 2).join(', '),
    remaining: Math.max(0, names.length - 2),
    full:
      unique.map((role) => role.name + (!voice && role.voice ? ' (voice)' : '')).join(', ') +
      (voice ? ' · Voice' : ''),
  };
}
