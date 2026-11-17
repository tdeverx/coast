import { onDestroy, untrack } from 'svelte';
import { useClient } from '#lib/ui/client-context.js';
import { feedbackForViewer } from '#lib/ui/action-feedback.svelte.js';
import { createMenuResource } from '#lib/ui/controls/menu-resource.svelte.js';
import { retryMenuRead } from '#lib/ui/controls/menu-read-retry.js';
import { message } from '#lib/ui/client.js';
import { useRetention } from '#lib/ui/retention.js';
import type { AddedSubtitle, SubtitleOptions, SubtitleResult } from './subtitles';

type Ports = {
  endpoint: () => string;
  owner: () => string;
  added: (subtitle: AddedSubtitle) => void | Promise<void>;
};

/** One resource for the active language, shared by the menu and its advanced dialog. */
export function createSubtitleControls(ports: Ports) {
  const { api, preview, feedback } = useClient('current-viewer');
  const retain = useRetention();
  const key = () => `${ports.owner()}:${ports.endpoint()}`;
  const options = createMenuResource<SubtitleOptions | null>(() => null, key,
    signal => api<SubtitleOptions>(ports.endpoint(), undefined, 'GET', { signal }), retryMenuRead);
  let language = $state('');
  const results = createMenuResource<SubtitleResult[] | null>(() => null, () => `${key()}:${options.data?.scope}:${language}`,
    signal => api<SubtitleResult[]>(ports.endpoint(), { language, scope: options.data?.scope }, 'POST', { signal }), retryMenuRead);
  let advanced = $state(false), downloading = $state<string>(), chosen = $state<{ id: string; index: number }>();
  let disposed = false;
  $effect(() => {
    const scope = key();
    untrack(() => {
      options.sync(scope);
      results.sync();
      advanced = false;
      chosen = undefined;
      language = '';
    });
  });
  onDestroy(() => { disposed = true; options.dispose(); results.dispose(); });
  feedback.watch(() => options.error || results.error);

  function openOptions() {
    if (options.data?.expiresAt && options.data.expiresAt <= Date.now()) {
      if (options.active && options.busy) return options.open();
      options.replace(null);
      void options.refresh();
    }
    return options.open();
  }
  async function openLanguage(code: string) {
    const owner = key();
    language = code;
    if (options.data?.expiresAt && options.data.expiresAt <= Date.now()) await openOptions();
    if (disposed || owner !== key() || language !== code || !options.active || !options.data?.scope) return;
    void results.open();
  }
  function closeLanguage(code: string) {
    if (!advanced && language === code) {
      language = '';
      results.close();
    }
  }
  function openAdvanced(code = options.data?.preferred) {
    if (!code) return;
    advanced = true;
    openLanguage(code);
  }
  function closeMenu() {
    if (advanced) return;
    options.close();
    results.close();
  }
  async function download(result: SubtitleResult) {
    if (downloading) return;
    const scope = key();
    const delivery = preview ? feedback : feedbackForViewer();
    const release = retain();
    downloading = result.id;
    try {
      const current = options.data;
      if (chosen?.id === result.id && current?.tracks.some(track => track.index === chosen?.index)) {
        await ports.added({ tracks: current.tracks, source: current.source, index: chosen.index });
        return;
      }
      const added = await api<AddedSubtitle>(ports.endpoint(), { ticket: result.ticket });
      if (disposed || key() !== scope) return;
      if (options.data) options.replace({ ...options.data, tracks: added.tracks });
      await ports.added(added);
      if (!disposed && key() === scope) {
        chosen = { id: result.id, index: added.index };
        delivery.notify('Subtitle added and selected.');
      }
    } catch (error) {
      if (!disposed && key() === scope) delivery.failure(message(error));
    } finally {
      downloading = undefined;
      release();
    }
  }
  return {
    options, results, openOptions, openLanguage, closeLanguage, openAdvanced, closeMenu, download,
    get language() { return language; },
    get downloading() { return downloading; },
    get chosen() { return chosen; },
    get advanced() { return advanced; },
    closeAdvanced() { advanced = false; closeMenu(); },
  };
}
export type SubtitleControls = ReturnType<typeof createSubtitleControls>;
