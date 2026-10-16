import { getContext, setContext } from 'svelte';
import { player, heroPlayer } from './client.svelte';
const key = Symbol('Playback preview');
type Playback = { player: typeof player; heroPlayer: typeof heroPlayer; preview: boolean };
export function usePlayback(): Playback { return getContext<Playback>(key) ?? { player, heroPlayer, preview: false }; }
export function providePreviewPlayback() {
 const local = $state<typeof player>({ session: null, audioQueue: [], audioIndex: -1, audioNotice: '', role: 'idle', paused: true, controlsVisible: true, browsing: false, subtitlePrompt: false, continuationId: '', muted: true, loading: false, preparationMediaType: 'video', preparationStartedAt: 0 });
 const hero = $state<typeof heroPlayer>({ id: '', url: '', rect: null, visible: false, paused: true, ready: false, playing: false, muted: true });
 const value = { player: local, heroPlayer: hero, preview: true };
 setContext<Playback>(key, value);
 return value;
}
