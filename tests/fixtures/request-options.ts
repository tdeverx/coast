import {compileRunes,moduleUrl,resourceUrl} from './ui-script';

const source=(await Bun.file(new URL('../../src/lib/ui/controls/request-options.svelte.ts',import.meta.url)).text())
  .replace("from '$lib/ui/resource.svelte'",`from ${JSON.stringify(resourceUrl)}`);
export const requestOptionsUrl=moduleUrl(compileRunes(source));
