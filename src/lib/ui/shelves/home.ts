import type { mediaRows } from '$lib/server/queries/media-rows';
import type { ShelfConfig } from './index';
/** Feature gates and personal scope are data, not another row component. */
export function homeShelves(rows: Awaited<ReturnType<typeof mediaRows>>, personal = false): ShelfConfig[] {
  if (!rows.enabled) return [];
  const ownGames = personal || rows.personal;
  return [
    {type:'library',surface:'listen',preview:{title:'Music',refreshKey:rows,empty:'Music from your connected libraries will appear here.'}},
    {type:'library',surface:'play',preview:{title:ownGames?'Your games':'Games',personal:ownGames,refreshKey:rows,
      empty:ownGames?'Start a playthrough to keep your games here.':'Add games to your library to find them here.'}},
  ];
}
