const BROWSER_PATH = 'src/browser/index.html';

/**
 * 已经开着就激活那一个。不查重的话点几次就是几个标签页，
 * 而它们各自持有一份内存缓存，纯属浪费。
 */
export async function openBrowser(): Promise<void> {
  const url = chrome.runtime.getURL(BROWSER_PATH);
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}
