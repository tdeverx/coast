import { getContext, setContext, type Snippet } from 'svelte';

const artwork = Symbol('Coast artwork sample');
export const getArtworkSample = () => getContext<Snippet | undefined>(artwork);
export const setArtworkSample = (sample: Snippet) => setContext(artwork, sample);
