import { createSharedFlights } from '#lib/server/utils/shared-flights.js';

export const createArtworkFlights = createSharedFlights<Uint8Array | null>;
