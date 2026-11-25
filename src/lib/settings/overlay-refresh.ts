const listeners = new Set<() => Promise<void>>();

export function onSettingsRefresh(refresh: () => Promise<void>) {
  listeners.add(refresh);
  return () => { listeners.delete(refresh); };
}

export async function refreshSettingsOverlay() {
  await Promise.all([...listeners].map(refresh => refresh()));
}
