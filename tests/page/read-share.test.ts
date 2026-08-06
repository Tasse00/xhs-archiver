// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readShareLinkFromPage } from '../../src/page/read-share';

const NOTE_ID = '6a7149a6000000003400fae7';
const LINK =
  `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}` +
  '?source=webshare&xhsshare=pc_web&xsec_token=T&xsec_source=pc_share';
const COPIED = `61 【标题 - 作者 | 小红书 - 你的生活兴趣社区】 😆 ${LINK}`;

/** 实测的分享按钮 DOM：两层 div 包一个 svg，外面还有一层信息流用的同名类。 */
function mountBar(): SVGElement {
  document.body.innerHTML = `
    <div class="engage-bar interactions">
      <div class="share-wrapper"><div class="share-icon-container"><svg class="reds-icon share-icon"></svg></div></div>
    </div>
    <div class="engage-bar">
      <div class="input-box"><div class="interact-container"><div class="buttons engage-bar-style">
        <div class="share-wrapper"><div class="share-icon-container"><svg class="reds-icon share-icon"></svg></div></div>
      </div></div></div>
    </div>`;
  return document.querySelector('.buttons.engage-bar-style .share-wrapper svg')!;
}

/** 挂上假面板。三条动作项与实测一致。 */
function mountPanel(onCopy: () => void): void {
  const panel = document.createElement('div');
  panel.className = 'xhs-note-share-popup';
  for (const label of ['私信好友', '复制链接', '扫码分享']) {
    const item = document.createElement('div');
    item.className = 'xhs-note-share-popup-action-item';
    item.innerHTML = `<span class="xhs-note-share-popup-action-label">${label}</span>`;
    if (label === '复制链接') item.addEventListener('click', onCopy);
    panel.appendChild(item);
  }
  document.body.appendChild(panel);
}

function unmountPanel(): void {
  document.querySelector('.xhs-note-share-popup')?.remove();
}

function panelOpen(): boolean {
  return document.querySelectorAll('.xhs-note-share-popup-action-item').length > 0;
}

/** 把 svg 的 click 接成「切换面板」，复制项调 writeText——就是页面的真实行为。 */
function wireToggle(svg: SVGElement, copyText: string | null): void {
  svg.addEventListener('click', () => {
    if (panelOpen()) unmountPanel();
    else mountPanel(() => { if (copyText !== null) void navigator.clipboard.writeText(copyText); });
  });
}

/** jsdom 默认没有 navigator.clipboard，测试自己装一个，并回传原始函数以便断言它没被调用。 */
function installClipboard(): { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: spy },
  });
  return { spy };
}

describe('readShareLinkFromPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    installClipboard();
  });

  it('找不到分享按钮时报 no_element', async () => {
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_element');
    expect(r.diag.elementFound).toBe(false);
  });

  it('走完整流程拿到剪贴板文案', async () => {
    const svg = mountBar();
    wireToggle(svg, COPIED);
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(COPIED);
    expect(r.diag.panelFound).toBe(true);
    expect(r.diag.via).toBe('writeText');
  });

  // 三层都派发 click 会 toggle 三次，净结果是面板关着。只能点 svg 一层。
  it('只对 svg 一层派发 click', async () => {
    const svg = mountBar();
    wireToggle(svg, COPIED);
    const wrapper = document.querySelector('.buttons.engage-bar-style .share-wrapper')!;
    const container = document.querySelector('.buttons.engage-bar-style .share-icon-container')!;
    let extra = 0;
    wrapper.addEventListener('click', (e) => { if (e.target === wrapper) extra++; });
    container.addEventListener('click', (e) => { if (e.target === container) extra++; });
    await readShareLinkFromPage();
    expect(extra).toBe(0);
  });

  // 使用者的剪贴板不该因为一次采集被覆盖
  it('拦住 writeText，不真的写剪贴板', async () => {
    const svg = mountBar();
    const { spy } = installClipboard();
    wireToggle(svg, COPIED);
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('结束后把 writeText 还原回去', async () => {
    const svg = mountBar();
    const { spy } = installClipboard();
    wireToggle(svg, COPIED);
    await readShareLinkFromPage();
    expect(navigator.clipboard.writeText).toBe(spy);
  });

  // 面板挡着使用者正在看的内容，我们开的就要我们关
  it('我们点开的面板结束时收起', async () => {
    const svg = mountBar();
    wireToggle(svg, COPIED);
    const r = await readShareLinkFromPage();
    expect(r.diag.alreadyOpen).toBe(false);
    expect(panelOpen()).toBe(false);
  });

  // 使用者自己点开的面板不属于我们，不动它
  it('本来就开着的面板保持开着，也不重复点开', async () => {
    const svg = mountBar();
    let toggles = 0;
    svg.addEventListener('click', () => { toggles++; });
    mountPanel(() => { void navigator.clipboard.writeText(COPIED); });
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(true);
    expect(r.diag.alreadyOpen).toBe(true);
    expect(toggles).toBe(0);
    expect(panelOpen()).toBe(true);
  });

  it('点了但面板没出来时报 no_panel', async () => {
    mountBar();
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_panel');
  });

  it('面板里没有「复制链接」时报 no_item', async () => {
    const svg = mountBar();
    svg.addEventListener('click', () => {
      const panel = document.createElement('div');
      panel.className = 'xhs-note-share-popup';
      for (const label of ['私信好友', '扫码分享']) {
        const item = document.createElement('div');
        item.className = 'xhs-note-share-popup-action-item';
        item.textContent = label;
        panel.appendChild(item);
      }
      document.body.appendChild(panel);
    });
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_item');
    expect(r.diag.panelFound).toBe(true);
  });

  it('点了复制但没人写剪贴板时报 timeout', async () => {
    const svg = mountBar();
    wireToggle(svg, null);
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
    // 失败也要把面板收回去
    expect(panelOpen()).toBe(false);
  });

  it('走 execCommand 通道时也能接住', async () => {
    const svg = mountBar();
    svg.addEventListener('click', () => {
      if (panelOpen()) { unmountPanel(); return; }
      mountPanel(() => {
        const ta = document.createElement('textarea');
        ta.value = COPIED;
        document.body.appendChild(ta);
        ta.focus();
        document.execCommand('copy');
        ta.remove();
      });
    });
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(COPIED);
    expect(r.diag.via).toBe('execCommand');
  });

  it('页面内抛异常时报 page_error 并带上现场', async () => {
    const svg = mountBar();
    svg.addEventListener('click', () => { throw new Error('boom'); });
    const r = await readShareLinkFromPage();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('page_error');
    expect(r.diag.error).toContain('boom');
  });
});
