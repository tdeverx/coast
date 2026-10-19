import type { ReadingFormat, ReadingKind, ReadingLocation } from '../model';
import type { ReaderProgress } from './load';
export type ReaderEngine = {
  previous(): Promise<void>;
  next(): Promise<void>;
  go(location: ReadingLocation): Promise<void>;
  resize?(): Promise<void>;
  leave?(): Promise<void>;
  canTurn?(direction: 'previous' | 'next'): boolean;
  destroy(): void;
};
export type ReaderOptions = {
  host: HTMLElement;
  source: File | string;
  manifest?: string;
  format: ReadingFormat;
  kind?: ReadingKind;
  location: ReadingLocation | null;
  signal: AbortSignal;
  changed: (location: ReadingLocation) => void;
  controlled?: () => boolean;
  failed?: (cause: unknown) => void;
  dismiss?: () => void;
  progress?: (progress: ReaderProgress) => void;
  sanitizeOddPages?: boolean;
};
export async function createReader(options: ReaderOptions): Promise<ReaderEngine> {
  options.signal.throwIfAborted();
  if (options.format === 'epub')
    return (await import('./epub')).epubReader(options);
  return (await import('./physical-reader')).physicalReader(options);
}
