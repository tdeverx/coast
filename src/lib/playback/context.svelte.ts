import { getContext, setContext } from 'svelte';
import { player, heroPlayer } from './client.svelte';
const key = Symbol('Playback preview');
type Playback = { player: typeof player; heroPlayer: typeof heroPlayer; preview: boolean };
export function usePlayback(): Playback { return getContext<Playback>(key) ?? { player, heroPlayer, preview: false }; }
export function providePreviewPlayback() {
 const local = $state({ ...player, session: null, audioQueue: [], audioIndex: -1, role: 'idle', paused: true }) as typeof player;
 const hero = $state({ ...heroPlayer, id: '', url: '', visible: false, playing: false });
 const value = { player: local, heroPlayer: hero, preview: true };
 setContext<Playback>(key, value);
 return value;
}
