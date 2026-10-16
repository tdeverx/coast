import type { Snippet } from 'svelte';
import { getContext, setContext } from 'svelte';

/** Reference-only layout slots. Editors retain ownership of their drafts. */
export type WorkspaceParts = {
  title: string;
  canvas: Snippet;
  inspector: Snippet;
  browser: Snippet<[{heading:Snippet}]>;
};

export type CanvasSettings = { background: string; color: string; image: string };
const canvasKey = Symbol('UI preview canvas');
export function provideCanvas(settings: CanvasSettings) { setContext(canvasKey, settings); }
export function useCanvas() { return getContext<CanvasSettings>(canvasKey); }
