import { administratorSettings, settingsSections } from './sections.js';

export function settingsTarget(href: string, base: Pick<URL, 'href' | 'origin'>) {
  let url: URL;
  try { url = new URL(href, base.href); } catch { return null; }
  if (url.origin !== base.origin || url.username || url.password || url.href.length > 2048) return null;
  const section = settingsSections.find(([id]) => url.pathname === `/settings/${id}`)?.[0];
  if (!section && url.pathname !== '/settings') return null;
  return {
    kind: 'settings' as const,
    href: url.pathname + url.search + url.hash,
    admin: administratorSettings.some(([id]) => id === section),
    section,
  };
}
