import type { ReadingLocation } from '../model';
import type { ReaderOptions } from './engine';
import { openComicArchive, COMIC_PAGE_LIMIT } from './comic-archive';
import { readerLoad } from './load';
import { physicalImage } from './physical-image';
import { remoteComic } from './remote-comic';
import { normalizeComicPages } from './physical/page-layout';
export type PhysicalPages = {
    count: number;
    page(index: number, signal: AbortSignal): Promise<HTMLCanvasElement>;
    location(index: number): ReadingLocation | undefined;
    pageFor(location: ReadingLocation | null): number;
    close(): Promise<void> | void;
};
export async function physicalPages(options: ReaderOptions): Promise<PhysicalPages> {
    const { source, format, signal } = options;
    signal.throwIfAborted();
    if (format === 'epub')
        throw new Error('EPUB uses its reflow reader.');
    if (format === 'pdf')
        return (await import('./physical-pdf')).physicalPdfPages(options);
    const remote = options.manifest ? await remoteComic(options.manifest, signal, options.progress) : undefined;
    if (remote && remote.manifest.format !== format)
        throw new Error('This reading edition changed.');
    const archive = remote ? undefined : await openComicArchive(source, format, signal, options.progress);
    const total = remote ? remote.manifest.pages.length : archive!.entries.length;
    try {
        if (!total)
            throw new Error('No readable images were found in this comic.');
        if (!remote)
            options.progress?.({ phase: 'inspect', loaded: 0, total });
        const pages = await normalizeComicPages({
            count: total,
            async dimensions(index: number, pageSignal: AbortSignal) {
                if (remote)
                    return remote.manifest.pages[index];
                const entry = archive!.entries[index];
                if (!entry || entry.size > COMIC_PAGE_LIMIT)
                    throw new Error('This comic page is too large.');
                const owner = AbortSignal.any([signal, pageSignal]);
                return physicalImage(await readerLoad(archive!.read(entry.index, owner), owner), owner, true);
            },
            async page(index: number, pageSignal: AbortSignal) {
                const owner = AbortSignal.any([signal, pageSignal]);
                if (remote)
                    return physicalImage(await remote.read(index, owner), owner);
                const entry = archive!.entries[index];
                if (!entry || entry.size > COMIC_PAGE_LIMIT)
                    throw new Error('This comic page is too large.');
                const blob = await readerLoad(archive!.read(entry.index, owner), owner);
                return physicalImage(blob, owner);
            },
            close: () => archive?.close(),
        }, signal, { sanitizeOddPages: options.sanitizeOddPages, onProgress: (loaded, total) => {
                if (!remote)
                    options.progress?.({ phase: 'inspect', loaded, total });
            } });
        return {
            ...pages,
            location(index) {
                const original = pages.sourcePage(index);
                return original === undefined ? undefined : { format, page: options.sanitizeOddPages !== false && index === pages.count - 1 ? total : original + 1, total };
            },
            pageFor(location) {
                return location?.format === format ? pages.physicalPage(location.page - 1) + 1 : 1;
            },
        };
    }
    catch (cause) {
        await archive?.close();
        throw cause;
    }
}
