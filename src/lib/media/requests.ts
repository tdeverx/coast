export type RequestDestination = {
  id: string;
  name: string;
  variants: { standard: RequestVariant | null; fourK: RequestVariant | null };
};
export type RequestVariant = {
  serverId: number | null;
  requestable: boolean;
  seasons: { number: number; requested: boolean; mine: boolean; available: boolean }[];
};
