import { authArtwork } from '#lib/auth/artwork.server.js';

// The artwork survives step navigation and progress refreshes.
export const load = async () => ({authArtwork:await authArtwork()});
