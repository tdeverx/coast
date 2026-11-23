import { getContext, setContext } from 'svelte';
import type { createCardTasteBatch } from './card-taste-batch';

type CurrentBatch = () => ReturnType<typeof createCardTasteBatch> | undefined;
export type CardTasteTarget = { workId: string; title: string; kind: string; cardScore: number };
type CardTaste = { current: CurrentBatch; explain: (target: CardTasteTarget) => void };
const key = Symbol('Card taste scores');
const empty: CardTaste = { current: () => undefined, explain: () => {} };

export function provideCardTaste(current: CurrentBatch, explain: CardTaste['explain']) { setContext<CardTaste>(key, {current, explain}); }
export function getCardTaste(): CardTaste { return getContext<CardTaste>(key) ?? empty; }
