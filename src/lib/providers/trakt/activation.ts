type TraktDevice = { userCode: string; verificationUrl: string };

export function traktActivationUrl(value: string) {
  return URL.canParse(value) && new URL(value).protocol === 'https:' ? value : undefined;
}

export async function copyTraktCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

// Request clipboard access and reserve the tab during the click, before the device request returns.
export function beginTraktActivation(previewCode?: string) {
  const code = Promise.withResolvers<string | null>();
  async function copyWhenReady() {
    if (previewCode) return copyTraktCode(previewCode);
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const text = code.promise.then(value => {
        if (!value) throw new Error('No pairing code issued');
        return new Blob([value], { type: 'text/plain' });
      });
      // A browser can deny the write before it reads the pending clipboard item.
      void text.catch(() => {});
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
        return true;
      } catch {
        return false;
      }
    }
    const value = await code.promise;
    return value ? copyTraktCode(value) : false;
  }
  const copied = copyWhenReady();
  const tab = window.open('about:blank', '_blank');
  if (tab) {
    tab.opener = null;
    tab.document.title = 'Connecting to Trakt';
    tab.document.body.textContent = 'Opening Trakt’s activation page…';
  }
  return (device: TraktDevice | null) => {
    code.resolve(device?.userCode ?? null);
    if (tab && !tab.closed) {
      const url = device && traktActivationUrl(device.verificationUrl);
      if (url) {
        tab.location.replace(url);
      } else tab.close();
    }
    return copied;
  };
}
