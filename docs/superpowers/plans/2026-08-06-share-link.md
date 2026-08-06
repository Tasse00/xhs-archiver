# 笔记分享链接采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 采集笔记时，通过合成事件让页面自己走完「分享 → 复制链接」流程，把产出的地址记进 `note.json` 的 `share_url`。

**Architecture:** 分三层，与已有的作者卡片功能同形。页面层 `src/page/read-share.ts` 注入 MAIN world，只负责点开分享面板、点「复制链接」、拦截剪贴板写入、把**原文**弄出来，不做任何解析。解析层 `src/core/share.ts` 是纯函数，把口令文案映射成链接并校验笔记身份。接线层在 sidepanel 的 `doArchive` 里把两者串起来，落盘经 `archiver` → `serialize`。采不到不阻断归档。

**Tech Stack:** TypeScript、React 19、Vitest 3（jsdom 环境跑页面脚本测试）、Chrome MV3 `chrome.scripting.executeScript`。

## Global Constraints

这些约束适用于**每一个** task，不再逐条重复：

- **权威设计文档**：`docs/superpowers/specs/2026-08-06-share-link-design.md`。与本计划冲突时以 spec 为准。
- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。每个 task 都是这个结构。
- **测试命令**：`npx vitest run <path>`（单文件）、`npm test`（全量）。
- **注释用中文，写「为什么」而不是「做了什么」。** 回复用户也用中文。
- **核心层不碰 DOM 和 chrome API**：`src/core/` 下的代码必须能在 Node 环境下跑。碰 `chrome.*` 的只能出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **注入到页面的函数体会被序列化后在页面上下文运行**，**不能引用本模块的任何外部变量**——常量、正则、辅助函数都得写在函数体里面。
- **注入脚本必须全程 try/catch 且始终返回值。** 抛出去会让 `executeScript` 的 `result` 变成 `undefined`，现场信息全丢。
- **采不到分享链接不阻断归档**，不算进 `partial`，`note.json` 里该字段整个缺席（不写空串占位）。
- **`schema_version` 保持 `1`**，不升。
- 每个 task 结束提交一次，commit message 已在步骤里给出。

---

## File Structure

| 文件 | 职责 | Task |
|---|---|---|
| `src/core/share.ts` | 新建。口令文案 → 链接，含笔记身份校验。纯函数 | 1 |
| `tests/core/share.test.ts` | 新建。`extractShareUrl` 的全部分支 | 1 |
| `src/page/read-share.ts` | 新建。注入页面，点面板、点复制、拦截剪贴板、回传原文 | 2 |
| `tests/page/read-share.test.ts` | 新建。jsdom 假面板，覆盖页面层全部失败分类与副作用 | 2 |
| `src/types.ts` | 改。`ExtractedNote.shareUrl?`、`NoteRecord.share_url?` | 3 |
| `src/core/serialize.ts` | 改。`share_url` 紧跟 `url` 落盘 | 3 |
| `tests/core/serialize.test.ts` | 改。有值时位置正确、无值时 key 缺席 | 3 |
| `src/core/archiver.ts` | 改。`share_url: note.shareUrl` 透传 | 3 |
| `tests/core/archiver.test.ts` | 改。透传与缺席 | 3 |
| `src/sidepanel/components/NoteView.tsx` | 改。`ShareOutcome` 类型、结果卡多一行、`pageStep` 取代 `authorReading` | 4 |
| `tests/sidepanel/note-view.test.ts` | 改。分享链接成功/失败两种呈现 | 4 |
| `src/sidepanel/App.tsx` | 改。`doArchive` 里读分享链接、`pageStep` 状态 | 5 |
| `src/core/browse/types.ts` | 改。`NoteDetail.shareUrl` | 6 |
| `src/core/browse/row-meta.ts` | 改。`shareUrl: j.share_url ?? ''` | 6 |
| `src/browser/components/DetailPane.tsx` | 改。`AuthorBlock` 收 `shareUrl`，原文链接优先用它 | 6 |
| `tests/browser/detail-pane.test.ts` | 改。优先用 `share_url`、无则回退 | 6 |
| `tests/core/browse/row-meta.test.ts` | 改。`share_url` 读进 `NoteDetail` | 6 |
| `CLAUDE.md` / `README.md` / 主设计文档 | 改。同步事实与决策，删掉已作废的说法 | 7 |

---

### Task 1: 解析层 —— `extractShareUrl`

把「复制链接」写进剪贴板的口令文案映射成笔记地址。纯字符串处理，先做这个是因为后面几个 task 都要用到它的返回类型。

**Files:**
- Create: `src/core/share.ts`
- Test: `tests/core/share.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type ShareUrlFailure = 'no_url' | 'id_mismatch'`
  - `type ShareUrlResult = { ok: true; url: string } | { ok: false; reason: ShareUrlFailure }`
  - `function extractShareUrl(text: string, expectedNoteId: string): ShareUrlResult`

- [ ] **Step 1: 写失败的测试**

创建 `tests/core/share.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { extractShareUrl } from '../../src/core/share';

const NOTE_ID = '6a7149a6000000003400fae7';

const LINK =
  `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}` +
  '?source=webshare&xhsshare=pc_web' +
  '&xsec_token=ABgs7kX8938ifiJA_xrpVY2l9vAGJLGjJVkg86_DgFol8=&xsec_source=pc_share';

/** 实测「复制链接」写进剪贴板的形态：分享码 + 标题 + 链接。 */
const COPIED = `61 【40万翻新的自建房还是毛胚怎么办？ - 大疏不是大叔 | 小红书 - 你的生活兴趣社区】 😆 ${LINK}`;

describe('extractShareUrl', () => {
  it('从口令文案里取出链接', () => {
    expect(extractShareUrl(COPIED, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('文案就是一条裸链接时照样取得到', () => {
    expect(extractShareUrl(LINK, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('文案里没有链接时报 no_url', () => {
    const r = extractShareUrl('61 【标题】 复制本条信息，打开【小红书】App', NOTE_ID);
    expect(r).toEqual({ ok: false, reason: 'no_url' });
  });

  it('空文本报 no_url', () => {
    expect(extractShareUrl('', NOTE_ID)).toEqual({ ok: false, reason: 'no_url' });
  });

  // 与作者卡片的 uid 校验同理：页面中途切了笔记，拿到的是上一篇的链接，
  // 写进去就是张冠李戴。
  it('链接指向别的笔记时报 id_mismatch', () => {
    const r = extractShareUrl(COPIED, '6a72e9160000000008012abb');
    expect(r).toEqual({ ok: false, reason: 'id_mismatch' });
  });

  // no_url 与 id_mismatch 指向完全不同的排查方向，不能兜成同一个值
  it('两种失败可区分', () => {
    const a = extractShareUrl('没有链接', NOTE_ID);
    const b = extractShareUrl(LINK, 'other');
    expect(a).not.toEqual(b);
  });

  it('链接后面还有文案时只取链接本身', () => {
    const withTail = `${COPIED}，复制本条信息，打开【小红书】App查看精彩内容！`;
    expect(extractShareUrl(withTail, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('剥掉链接尾部的中文标点', () => {
    expect(extractShareUrl(`${LINK}。`, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('链接被引号包住时不把引号算进去', () => {
    expect(extractShareUrl(`分享："${LINK}"`, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/core/share.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/share"`

- [ ] **Step 3: 写最小实现**

创建 `src/core/share.ts`：

```ts
export type ShareUrlFailure =
  /** 文案里根本没有链接——多半是平台改了口令模板 */
  | 'no_url'
  /** 链接指向别的笔记——页面中途切了笔记 */
  | 'id_mismatch';

export type ShareUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: ShareUrlFailure };

/**
 * 链接的结束边界。字符类同时承担两件事：在空白处截断，以及剥掉紧贴在
 * 链接尾部的中文标点与引号。所以匹配完不需要再 trim 一次。
 */
const LINK_RE = /https?:\/\/[^\s，。！？、）】」"'<>]+/;

/**
 * 从「复制链接」写进剪贴板的口令文案里取出笔记地址。
 *
 * 实测文案形态：`61 【标题 - 作者 | 小红书…】 😆 https://…/discovery/item/{id}?…`
 * 开头的数字是分享码，我们不要。
 *
 * 返回判别联合而不是 `string | null`：no_url 说明模板变了，id_mismatch 说明
 * 页面中途切了笔记，两者要查的地方完全不同，兜成同一个 null 就把区别丢了。
 */
export function extractShareUrl(text: string, expectedNoteId: string): ShareUrlResult {
  const m = LINK_RE.exec(text);
  if (!m) return { ok: false, reason: 'no_url' };

  const url = m[0];
  // 不校验就可能把上一篇的链接写进这一篇的 note.json。宁可不写，不可写错。
  if (!url.includes(expectedNoteId)) return { ok: false, reason: 'id_mismatch' };

  return { ok: true, url };
}
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/core/share.test.ts`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add src/core/share.ts tests/core/share.test.ts
git commit -m "feat: 从分享口令文案里解析笔记链接

返回判别联合而不是 string | null：no_url 是模板变了，id_mismatch 是
页面中途切了笔记，两者的排查方向完全不同。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 页面层 —— `read-share.ts`

注入页面，用合成事件走完分享流程，把剪贴板文案接出来。这是整个功能唯一有风险的部分。

**Files:**
- Create: `src/page/read-share.ts`
- Test: `tests/page/read-share.test.ts`

**Interfaces:**
- Consumes: 无（本 task 不 import Task 1 的东西——页面脚本不做解析）
- Produces:
  - `interface ShareDiag { elementFound: boolean; alreadyOpen: boolean; panelFound: boolean; via: 'writeText' | 'execCommand' | null; waitedMs: number; error?: string }`
  - `type ShareReadFailure = 'no_element' | 'no_panel' | 'no_item' | 'timeout' | 'page_error' | 'inject_failed'`
  - `type ShareReadResult = { ok: true; text: string; diag: ShareDiag } | { ok: false; reason: ShareReadFailure; detail?: string; diag: ShareDiag }`
  - `function readShareLinkFromPage(): Promise<ShareReadResult>`（注入用）
  - `function readShareViaTab(tabId: number): Promise<ShareReadResult>`

**实测约束**（必须写进代码注释）：
1. 分享按钮是 `.buttons.engage-bar-style .share-wrapper svg`。只用 `.engage-bar .share-wrapper` 会命中 modal 背后信息流卡片上的分享图标——页面上存在两套 `engage-bar`。
2. **只能对 svg 一层派发 click。** 对 `.share-wrapper`、`.share-icon-container`、`svg` 三层都派发会连续 toggle 三次，净结果是面板关着，现象看起来像「合成事件对这个组件无效」。
3. **不需要** hover 祖先链——与作者卡片不同。
4. 复制之后面板**不会自动关**，必须再点一次 svg。
5. 剪贴板要拦截而不真写，否则会覆盖使用者当前的剪贴板内容。

- [ ] **Step 1: 写失败的测试**

创建 `tests/page/read-share.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/page/read-share.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/page/read-share"`

- [ ] **Step 3: 写最小实现**

创建 `src/page/read-share.ts`：

```ts
/** 每次读取都回传的现场快照，用于排查。 */
export interface ShareDiag {
  /** 有没有找到 .buttons.engage-bar-style .share-wrapper svg */
  elementFound: boolean;
  /** 进来时面板是不是使用者自己已经点开的 */
  alreadyOpen: boolean;
  /** 面板有没有出现 */
  panelFound: boolean;
  /** 真正接住文案的通道 */
  via: 'writeText' | 'execCommand' | null;
  /** 实际等了多少毫秒 */
  waitedMs: number;
  error?: string;
}

export type ShareReadFailure =
  /** 页面上找不到分享按钮——多半是小红书改版，选择器失效 */
  | 'no_element'
  /** 点了但面板没出来 */
  | 'no_panel'
  /** 面板出来了但没有「复制链接」这一条 */
  | 'no_item'
  /** 点了复制但没人写剪贴板 */
  | 'timeout'
  /** 页面内抛异常 */
  | 'page_error'
  /** 注入本身没跑成 */
  | 'inject_failed';

export type ShareReadResult =
  | { ok: true; text: string; diag: ShareDiag }
  | { ok: false; reason: ShareReadFailure; detail?: string; diag: ShareDiag };

/**
 * 注入到页面 MAIN world 执行：让页面自己走完「分享 → 复制链接」，把它要写进
 * 剪贴板的文案接住，再把面板收回去。**只回传原文，不做解析**——文案到链接的
 * 映射在 core/share.ts，那边能在 Node 下测。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**，
 * 常量、辅助函数都得写在函数体里。
 *
 * 五条实测约束：
 * 1. 分享按钮是 `.buttons.engage-bar-style .share-wrapper svg`。只写
 *    `.engage-bar .share-wrapper` 会命中 modal 背后信息流卡片上的分享图标——
 *    页面上存在两套 engage-bar。
 * 2. **只能对 svg 一层派发 click。** 对 wrapper / container / svg 三层都派发会
 *    连续 toggle 三次，净结果是面板关着，现象看起来像「合成事件无效」。
 * 3. 不需要 hover 祖先链——这点与作者卡片不同，那边必须逐层派发 enter。
 * 4. 点完「复制链接」面板不会自动关，必须再点一次 svg。
 * 5. 剪贴板要拦截而不真写：使用者的剪贴板不该因为一次采集被覆盖。
 */
export async function readShareLinkFromPage(): Promise<ShareReadResult> {
  const diag: ShareDiag = {
    elementFound: false,
    alreadyOpen: false,
    panelFound: false,
    via: null,
    waitedMs: 0,
  };

  // 还原用的现场，必须在 try 外面声明——catch 里也要能收拾干净。
  let restoreClipboard: (() => void) | null = null;
  let origExec: typeof document.execCommand | null = null;

  try {
    const TIMEOUT_MS = 3000;
    const POLL_MS = 100;
    const ITEM = '.xhs-note-share-popup-action-item';

    const svg = document.querySelector('.buttons.engage-bar-style .share-wrapper svg');
    diag.elementFound = svg !== null;
    if (!svg) return { ok: false, reason: 'no_element', diag };

    // jsdom 里 PointerEvent 支持不完整，真实页面上偶尔也会缺；降级到 MouseEvent
    // 不影响触发——这个组件只看 click。
    const PE: typeof MouseEvent =
      typeof PointerEvent !== 'undefined' ? (PointerEvent as unknown as typeof MouseEvent) : MouseEvent;

    /** 对**单个**元素派发一整套按下-抬起-点击。绝不对祖先链重复派发，见约束 2。 */
    const click = (el: Element) => {
      const r = el.getBoundingClientRect();
      const o: MouseEventInit = {
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new PE('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PE('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    };

    const items = (): Element[] => Array.from(document.querySelectorAll(ITEM));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const started = Date.now();

    // 使用者自己点开的面板不属于我们，记下来，结束时原样留着。
    diag.alreadyOpen = items().length > 0;
    if (!diag.alreadyOpen) {
      click(svg);
      while (Date.now() - started < TIMEOUT_MS && items().length === 0) await sleep(POLL_MS);
    }

    /** 我们开的就要我们关；本来就开着的不动。失败路径也要走一遍。 */
    const restorePanel = () => {
      if (!diag.alreadyOpen && items().length > 0) {
        try { click(svg); } catch (e) { /* 收不起来也不该丢掉已经拿到的数据 */ }
      }
    };

    diag.panelFound = items().length > 0;
    if (!diag.panelFound) {
      diag.waitedMs = Date.now() - started;
      return { ok: false, reason: 'no_panel', diag };
    }

    const copyItem = items().find((el) => (el.textContent ?? '').indexOf('复制链接') >= 0);
    if (!copyItem) {
      diag.waitedMs = Date.now() - started;
      restorePanel();
      return { ok: false, reason: 'no_item', diag };
    }

    let captured: { via: 'writeText' | 'execCommand'; text: string } | null = null;

    // 拦截而不写入。用前存下描述符：直接 delete 会在页面本来就有同名自有属性时
    // 把它永久抹掉。navigator.clipboard 在非安全上下文下可能压根不存在。
    const clip = navigator.clipboard as { writeText?: (t: string) => Promise<void> } | undefined;
    if (clip && typeof clip.writeText === 'function') {
      const desc = Object.getOwnPropertyDescriptor(clip, 'writeText');
      Object.defineProperty(clip, 'writeText', {
        configurable: true,
        writable: true,
        value: (t: string) => {
          if (!captured) captured = { via: 'writeText', text: String(t) };
          return Promise.resolve();
        },
      });
      restoreClipboard = () => {
        if (desc) Object.defineProperty(clip, 'writeText', desc);
        else delete (clip as Record<string, unknown>).writeText;
      };
    }

    // execCommand 兜底：老实现走的是选中 textarea 再 copy 这条路。
    origExec = document.execCommand.bind(document);
    document.execCommand = function (cmd: string, ...rest: unknown[]) {
      if (String(cmd).toLowerCase() === 'copy') {
        const a = document.activeElement as { value?: string; textContent?: string | null } | null;
        const t = a && a.value !== undefined ? a.value : a?.textContent ?? '';
        if (!captured && t) captured = { via: 'execCommand', text: String(t) };
        return true;
      }
      return (origExec as (c: string, ...r: unknown[]) => boolean)(cmd, ...rest);
    } as typeof document.execCommand;

    click(copyItem);
    while (Date.now() - started < TIMEOUT_MS && !captured) await sleep(POLL_MS);
    diag.waitedMs = Date.now() - started;

    restorePanel();

    if (!captured) return { ok: false, reason: 'timeout', diag };
    const hit = captured as { via: 'writeText' | 'execCommand'; text: string };
    diag.via = hit.via;
    return { ok: true, text: hit.text, diag };
  } catch (e) {
    diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason: 'page_error', detail: diag.error, diag };
  } finally {
    // 无论走哪条路都必须把页面还回去，否则使用者的剪贴板从此归我们管。
    try { restoreClipboard?.(); } catch (e) { /* 还原失败不该盖掉真正的失败原因 */ }
    if (origExec) document.execCommand = origExec;
  }
}

const EMPTY_DIAG: ShareDiag = {
  elementFound: false,
  alreadyOpen: false,
  panelFound: false,
  via: null,
  waitedMs: 0,
};

/**
 * 注入失败与「页面上没有分享按钮」必须分开报：前者是扩展侧问题（权限、world、
 * 时序），后者是页面侧问题（改版、还没渲染）。
 *
 * 不接收 expectedNoteId——身份校验在 core/share.ts 那一层做。
 */
export async function readShareViaTab(tabId: number): Promise<ShareReadResult> {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readShareLinkFromPage,
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'inject_failed',
      detail: e instanceof Error ? e.message : String(e),
      diag: { ...EMPTY_DIAG },
    };
  }

  const result = res?.result as ShareReadResult | undefined;
  if (!result) {
    // Chrome 把页面内抛出的异常放在 error 字段里，没有它就只剩「无返回值」。
    const injectionError = (res as { error?: { message?: string } } | undefined)?.error?.message;
    return {
      ok: false,
      reason: 'inject_failed',
      detail: injectionError ?? (res ? '注入脚本无返回值' : '注入未命中任何 frame'),
      diag: { ...EMPTY_DIAG },
    };
  }
  return result;
}
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/page/read-share.test.ts`
Expected: PASS，12 个用例全绿。两个超时用例各花约 3 秒，整体在 10 秒内。

- [ ] **Step 5: 提交**

```bash
git add src/page/read-share.ts tests/page/read-share.test.ts
git commit -m "feat: 用合成事件让页面走完分享流程，接出复制链接的文案

只对 svg 一层派发 click——三层都派发会 toggle 三次抵消掉，看起来像
合成事件无效。剪贴板拦截而不真写，使用者的剪贴板不该被一次采集覆盖。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 落盘 —— 类型、序列化、archiver

把 `share_url` 从 `ExtractedNote` 一路带到 `note.json`。

**Files:**
- Modify: `src/types.ts:157-170`（`ExtractedNote`）、`src/types.ts:195-216`（`NoteRecord`）
- Modify: `src/core/serialize.ts:51-92`（`serializeNote`）
- Modify: `src/core/archiver.ts:139-160`（`record` 组装）
- Test: `tests/core/serialize.test.ts`、`tests/core/archiver.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ExtractedNote.shareUrl?: string`
  - `NoteRecord.share_url?: string`
  - `note.json` 里 `share_url` 紧跟 `url`，值为 `undefined` 时整个 key 缺席

- [ ] **Step 1: 写失败的测试**

在 `tests/core/serialize.test.ts` 的 `describe('serializeNote', …)` 里追加：

```ts
  it('share_url 紧跟在 url 后面', () => {
    const out = serializeNote({ ...base, share_url: 'https://www.xiaohongshu.com/discovery/item/abc?xsec_token=T' });
    const keys = Object.keys(JSON.parse(out));
    expect(keys[keys.indexOf('url') + 1]).toBe('share_url');
  });

  // 没采到就一个字段都不写，不用空串占位——与作者卡片同一条决策
  it('没有 share_url 时整个 key 缺席', () => {
    const out = serializeNote(base);
    expect(out).not.toContain('share_url');
    expect(Object.keys(JSON.parse(out))).not.toContain('share_url');
  });
```

在 `tests/core/archiver.test.ts` 的顶层 `describe` 里追加两个用例：

```ts
  it('把 shareUrl 写进 note.json 的 share_url', async () => {
    const link = `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?source=webshare&xsec_token=T`;
    await archive({
      store, note: { ...goodNote(), shareUrl: link }, collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
    });
    const j = JSON.parse((await store.readText(`zach/2026-08-03/${NOTE_ID}/note.json`))!);
    expect(j.share_url).toBe(link);
  });

  // 采不到分享链接不阻断归档，也不留占位
  it('没有 shareUrl 时 note.json 里没有 share_url，归档照常完成', async () => {
    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
    });
    expect(res.status).toBe('complete');
    const j = JSON.parse((await store.readText(`zach/2026-08-03/${NOTE_ID}/note.json`))!);
    expect('share_url' in j).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/core/serialize.test.ts tests/core/archiver.test.ts`
Expected: FAIL —— serialize 那两条因为 `share_url` 不在输出里、TS 报 `share_url` 不存在于 `NoteRecord`；archiver 那条因为 `shareUrl` 不存在于 `ExtractedNote`

- [ ] **Step 3: 写最小实现**

`src/types.ts`，在 `ExtractedNote` 的 `url` 下面加一行：

```ts
export interface ExtractedNote {
  noteId: string;
  url: string;
  /**
   * 分享面板「复制链接」产出的地址。带 xsec_token，会过期，每次签发都不同。
   * extractor 拿不到页面，所以由 sidepanel 在采集时补上；采不到就不设这个字段。
   */
  shareUrl?: string;
  title: string;
```

在 `NoteRecord` 的 `url` 下面加一行：

```ts
export interface NoteRecord {
  schema_version: 1;
  note_id: string;
  url: string;
  /** 见 ExtractedNote.shareUrl。采不到时整个字段缺席，不写空串。 */
  share_url?: string;
  type: 'normal';
```

`src/core/serialize.ts` 的 `serializeNote`，在 `url` 之后插一行：

```ts
export function serializeNote(n: NoteRecord): string {
  return stringify({
    schema_version: n.schema_version,
    note_id: n.note_id,
    url: n.url,
    // undefined 会被 JSON.stringify 直接丢掉，所以「采不到就整个字段缺席」
    // 不需要额外分支，其余 key 的顺序也不受影响。
    share_url: n.share_url,
    type: n.type,
```

`src/core/archiver.ts` 的 `record` 组装，在 `url` 之后插一行：

```ts
  const record: NoteRecord = {
    schema_version: 1,
    note_id: note.noteId,
    url: note.url,
    share_url: note.shareUrl,
    type: 'normal',
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/core/serialize.test.ts tests/core/archiver.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/core/serialize.ts src/core/archiver.ts tests/core/serialize.test.ts tests/core/archiver.test.ts
git commit -m "feat: note.json 落盘 share_url

紧跟 url，采不到时整个 key 缺席——JSON.stringify 会丢掉 undefined，
不需要额外分支。url 保持不动：它是笔记的稳定身份，share_url 是当下
能点开的入口，两者语义分开。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 侧边栏呈现 —— `NoteView`

结果卡多一行「分享链接」，采集中的提示从「读作者」一个布尔量改成两步的 `pageStep`。

**Files:**
- Modify: `src/sidepanel/components/NoteView.tsx:13-28`（类型）、`:57-63`（失败文案表）、`:115-156`（`Result`）、`:158-170` 与 `:296-325`（`NoteView` 的 props 与动作区）
- Test: `tests/sidepanel/note-view.test.ts`

**Interfaces:**
- Consumes: `ShareReadFailure`（Task 2）、`ShareUrlFailure`（Task 1）
- Produces:
  - `type ShareOutcome = { ok: true; url: string } | { ok: false; reason: ShareReadFailure | ShareUrlFailure }`
  - `ArchiveOutcome.share: ShareOutcome`
  - `NoteView` 的 prop：`pageStep: 'author' | 'share' | null`（取代 `authorReading: boolean`）

- [ ] **Step 1: 写失败的测试**

改 `tests/sidepanel/note-view.test.ts` 的 `outcome` 工厂并追加一个 describe：

```ts
function outcome(
  author: ArchiveOutcome['author'],
  share: ArchiveOutcome['share'] = { ok: true, url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T' },
): ArchiveOutcome {
  return {
    mode: 'new', status: 'complete', path: 'collected/n1', failures: [],
    imageCount: 3, comments, commentImageFailures: [], author, share,
  };
}

describe('Result 里的分享链接', () => {
  it('采到时说明已记录', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(
        { ok: true, fans: 1, interaction: 1, approximate: false },
        { ok: true, url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T' },
      ),
    }));
    expect(html).toContain('分享链接');
    expect(html).toContain('已记录');
  });

  // 采不到不阻断归档，但必须如实说
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(
        { ok: true, fans: 1, interaction: 1, approximate: false },
        { ok: false, reason: 'no_panel' },
      ),
    }));
    expect(html).toContain('采集完成');
    expect(html).toContain('分享链接未采到');
    expect(html).toContain('分享面板没弹出来');
    expect(html).toContain('重采这篇可以再试');
  });

  it('解析层的失败也能原样说出来', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(
        { ok: true, fans: 1, interaction: 1, approximate: false },
        { ok: false, reason: 'id_mismatch' },
      ),
    }));
    expect(html).toContain('链接指向别的笔记');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: FAIL —— TS 报 `share` 不存在于 `ArchiveOutcome`

- [ ] **Step 3: 写最小实现**

`src/sidepanel/components/NoteView.tsx`：

顶部 import 加一行，并在 `AuthorOutcome` 后面加 `ShareOutcome`：

```ts
import type { AuthorReadFailure } from '../../page/read-author';
import type { ShareReadFailure } from '../../page/read-share';
import type { ShareUrlFailure } from '../../core/share';
```

```ts
/**
 * 分享链接这一步的结果。失败原因跨两层：页面层没点开面板是一回事，
 * 解析层发现链接指向别的笔记是另一回事，两者的排查方向完全不同。
 */
export type ShareOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: ShareReadFailure | ShareUrlFailure };
```

`ArchiveOutcome` 加一个字段：

```ts
export interface ArchiveOutcome {
  mode: ArchiveMode;
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
  imageCount: number;
  comments: ExtractedComments;
  commentImageFailures: string[];
  author: AuthorOutcome;
  share: ShareOutcome;
}
```

在 `AUTHOR_FAIL` 下面加失败文案表：

```ts
const SHARE_FAIL: Record<ShareReadFailure | ShareUrlFailure, string> = {
  no_element: '页面上没找到分享按钮',
  no_panel: '分享面板没弹出来',
  no_item: '面板里没有「复制链接」',
  timeout: '等复制结果超时',
  no_url: '复制出来的文案里没有链接',
  id_mismatch: '链接指向别的笔记',
  page_error: '页面脚本出错',
  inject_failed: '注入页面脚本失败',
};
```

`Result` 的 `<dl>` 里，「作者」那个 `<dd>` 之后追加：

```tsx
        <dt>分享链接</dt>
        <dd>
          {outcome.share.ok
            ? '已记录'
            : `分享链接未采到：${SHARE_FAIL[outcome.share.reason]}。重采这篇可以再试。`}
        </dd>
```

`NoteView` 的 props：把 `authorReading: boolean` 换成 `pageStep`：

```tsx
export function NoteView({
  state, collector, datasetPath, onEditDatasetPath, onArchive, progress, message, justArchived, pageStep,
}: {
  state: PanelState;
  collector: string;
  datasetPath: string;
  onEditDatasetPath(): void;
  onArchive(mode: ArchiveMode): void;
  progress: { done: number; total: number } | null;
  message: string | null;
  justArchived: ArchiveOutcome | null;
  /** 正在做哪一步页面交互。null 表示没在做。 */
  pageStep: 'author' | 'share' | null;
}) {
```

动作区的第一个分支改掉：

```tsx
        {pageStep ? (
          <>
            <div className="sect-h">
              {pageStep === 'author' ? '正在读取作者信息…' : '正在读取分享链接…'}
            </div>
            <p className="hint">
              {pageStep === 'author'
                ? '页面上会闪一下作者卡片，随后自动收起。'
                : '页面上会弹一下分享面板，随后自动收起。剪贴板不会被改动。'}
            </p>
            <button className="btn" disabled>采集中…</button>
          </>
        ) : progress ? (
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: PASS。`src/sidepanel/App.tsx` 此时会有 TS 错误（还在传 `authorReading`），下个 task 修。

- [ ] **Step 5: 提交**

```bash
git add src/sidepanel/components/NoteView.tsx tests/sidepanel/note-view.test.ts
git commit -m "feat: 侧边栏结果卡呈现分享链接的采集结果

失败文案表覆盖页面层与解析层两个 union——no_panel 与 id_mismatch 要查
的地方完全不同。采集中的提示从单个布尔量改成 pageStep，因为现在是两步
页面交互。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 接线 —— `App.tsx` 的 `doArchive`

把页面层、解析层、落盘串起来。

**Files:**
- Modify: `src/sidepanel/App.tsx:1-24`（import）、`:90`（state）、`:304-398`（`doArchive`）、`:472`（传 prop）

**Interfaces:**
- Consumes: `readShareViaTab`（Task 2）、`extractShareUrl` / `ShareUrlResult`（Task 1）、`ShareOutcome` / `pageStep`（Task 4）、`ExtractedNote.shareUrl`（Task 3）
- Produces: 无（终点）

- [ ] **Step 1: 改 import 与 state**

`src/sidepanel/App.tsx` 顶部：

```ts
import { readAuthorViaTab } from '../page/read-author';
import { readShareViaTab } from '../page/read-share';
import { extractAuthorCard } from '../core/author';
import { extractShareUrl } from '../core/share';
```

```ts
import { NoteView, type ArchiveOutcome, type AuthorOutcome, type ShareOutcome } from './components/NoteView';
```

把第 90 行的 state 换掉：

```ts
  // 两步页面交互（作者卡片、分享面板）串行执行，界面要能分别说清在做哪一步。
  const [pageStep, setPageStep] = useState<'author' | 'share' | null>(null);
```

- [ ] **Step 2: 改 `doArchive`**

把原来的作者卡片段落（`setAuthorReading(true)` 到 `finally { setAuthorReading(false); }`）替换成下面这段。注意 `tab` 只查一次，两步复用：

```ts
    // 两步页面交互，都在使用者眼皮底下发生，所以串行、各自兜住异常。
    // 任一步失败都不阻断归档——附属数据不该把主干拖下水。
    // 初值就是失败态：任何一条岔路都不该让后面的 archive 拿到未赋值的变量。
    let author: AuthorOutcome = { ok: false, reason: 'inject_failed' };
    let share: ShareOutcome = { ok: false, reason: 'inject_failed' };
    const noteToWrite = { ...plan.note };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;

    // 作者卡片：约 1.5–3 秒，期间卡片会在页面上闪现后自动收起。
    setPageStep('author');
    try {
      if (tabId !== undefined) {
        const read = await readAuthorViaTab(tabId, plan.note.author.user_id);
        if (read.ok) {
          const card = extractAuthorCard(read.raw, nowBeijingIso());
          if (card) {
            noteToWrite.author = { ...plan.note.author, ...card };
            author = { ok: true, fans: card.fans, interaction: card.interaction, approximate: card.approximate };
          } else {
            // 卡片回来了但三个计数一个都没有，等同于没采到。
            author = { ok: false, reason: 'timeout' };
          }
        } else {
          author = { ok: false, reason: read.reason };
        }
      }
    } catch (e) {
      // 读作者是附属步骤，它自己出错绝不能把整篇采集带下水。
      author = { ok: false, reason: 'page_error' };
    }

    // 分享链接：让页面自己走完「分享 → 复制链接」。面板会弹出来一两秒，
    // 剪贴板被拦下不真写。解析与身份校验在 core，页面脚本只负责弄出原文。
    setPageStep('share');
    try {
      if (tabId !== undefined) {
        const read = await readShareViaTab(tabId);
        if (read.ok) {
          const parsed = extractShareUrl(read.text, plan.note.noteId);
          if (parsed.ok) {
            noteToWrite.shareUrl = parsed.url;
            share = { ok: true, url: parsed.url };
          } else {
            share = { ok: false, reason: parsed.reason };
          }
        } else {
          share = { ok: false, reason: read.reason };
        }
      }
    } catch (e) {
      share = { ok: false, reason: 'page_error' };
    } finally {
      setPageStep(null);
    }
```

- [ ] **Step 3: 把结果带进 `justArchived`**

`setJustArchived({...})` 里追加一行：

```ts
      author,
      share,
    });
```

并把第 472 行的 prop 换掉：

```tsx
          pageStep={pageStep}
```

- [ ] **Step 4: 跑全量测试与类型检查**

Run: `npm test`
Expected: 全绿

Run: `npx tsc --noEmit`
Expected: 无错误。若报 `authorReading` 还有残留引用，把它们清干净。

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat: 采集时读取分享链接并写进 note.json

作者卡片与分享链接两步页面交互串行执行，共用一次 tabs.query，各自兜住
异常。任一步失败都不阻断归档。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 浏览页 —— 原文链接改用 `share_url`

现在详情栏的「小红书原文」指向 `/explore/{id}`，实测点开是 404。

**Files:**
- Modify: `src/core/browse/types.ts:55-61`（`NoteDetail`）
- Modify: `src/core/browse/row-meta.ts:58-63`（`detail` 组装）
- Modify: `src/browser/components/DetailPane.tsx:123-146`（`AuthorBlock`）、`:206`（调用处）
- Test: `tests/browser/detail-pane.test.ts`、`tests/core/browse/row-meta.test.ts`

**Interfaces:**
- Consumes: `NoteRecord.share_url`（Task 3）
- Produces:
  - `NoteDetail.shareUrl: string`（缺省 `''`）
  - `AuthorBlock` 的 props 由 `{ author, noteUrl }` 变为 `{ author, noteUrl, shareUrl }`

- [ ] **Step 1: 写失败的测试**

`tests/browser/detail-pane.test.ts` 的 `describe('AuthorBlock', …)` 里，把现有三个用例的 `createElement(AuthorBlock, {...})` 都补上 `shareUrl: ''`，然后追加：

```ts
  // 不带 xsec_token 的 /explore/{id} 实测已经 404，有分享链接就该用它
  it('有分享链接时原文指向分享链接', () => {
    const share = 'https://www.xiaohongshu.com/discovery/item/n1?source=webshare&xsec_token=T';
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base,
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
      shareUrl: share,
    }));
    expect(html).toContain(`href="${share}"`);
    expect(html).not.toContain('href="https://www.xiaohongshu.com/explore/n1"');
  });

  // 老数据没有 share_url，回退到旧地址总比没有链接强
  it('没有分享链接时回退到 url', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base,
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
      shareUrl: '',
    }));
    expect(html).toContain('href="https://www.xiaohongshu.com/explore/n1"');
  });
```

在 `tests/core/browse/row-meta.test.ts` 的 `describe('loadNote', …)` 里追加两个用例。该文件已有 `noteJson(over)` 工厂（接受一个覆盖对象）、常量 `A` / `DS` / `ref` 与 `beforeEach` 里建好的 `store`，直接用，别新建 fixture：

```ts
  it('把 share_url 读进 NoteDetail', async () => {
    const link = `https://www.xiaohongshu.com/discovery/item/${A}?source=webshare&xsec_token=T`;
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ share_url: link }));
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.detail.shareUrl).toBe(link);
  });

  // 老数据没有这个字段，不能变成 undefined 传到 React 里
  it('老 note.json 没有 share_url 时给空串', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.detail.shareUrl).toBe('');
  });
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/browser/detail-pane.test.ts tests/core/browse/row-meta.test.ts`
Expected: FAIL —— TS 报 `shareUrl` 不存在于 `AuthorBlock` 的 props 与 `NoteDetail`

- [ ] **Step 3: 写最小实现**

`src/core/browse/types.ts`：

```ts
export interface NoteDetail {
  url: string;
  /** 分享面板产出的地址，带 xsec_token。老数据没有这个字段，此时为空串。 */
  shareUrl: string;
  author: NoteRecord['author'];
  /** NoteRecord 没有顶层 IP 字段，只能从 raw.ipLocation 取。取完 raw 就丢 */
  ipLocation: string;
  images: ImageRecord[];
}
```

`src/core/browse/row-meta.ts` 的 `detail` 组装：

```ts
    detail: {
      url: j.url ?? '',
      shareUrl: j.share_url ?? '',
      author: j.author,
      ipLocation: typeof raw?.ipLocation === 'string' ? raw.ipLocation : '',
      images: j.images,
    },
```

`src/browser/components/DetailPane.tsx` 的 `AuthorBlock`：

```tsx
export function AuthorBlock({
  author, noteUrl, shareUrl,
}: { author: ArchivedAuthor; noteUrl: string; shareUrl: string }) {
  const hasCard = author.card_fetched_at !== undefined;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString('zh-CN');
  const approx = author.approximate === true ? '约 ' : '';
  // 不带 xsec_token 的 /explore/{id} 实测已经 404，所以有分享链接就用它。
  // 老数据没有，回退到旧地址——点开是 404，但重采一次就修好了。
  const href = shareUrl || noteUrl;
```

把 `<a href={noteUrl} …>` 改成 `<a href={href} …>`。

调用处（`:206` 附近）：

```tsx
        <AuthorBlock author={detail.author} noteUrl={detail.url} shareUrl={detail.shareUrl} />
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/browser/detail-pane.test.ts tests/core/browse/row-meta.test.ts`
Expected: PASS

Run: `npm test && npx tsc --noEmit`
Expected: 全绿、无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/core/browse/types.ts src/core/browse/row-meta.ts src/browser/components/DetailPane.tsx tests/browser/detail-pane.test.ts tests/core/browse/row-meta.test.ts
git commit -m "fix: 浏览页原文链接改用 share_url

不带 xsec_token 的 /explore/{id} 实测已经 404，旧链接点开进不去笔记。
老数据没有 share_url 时回退到旧地址，重采一次即可修复。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 文档同步

本项目的设计经历过多轮推翻重来，下一个 session 完全依赖文档判断现状。有一条已作废的说法必须删掉，不能留着。

**Files:**
- Modify: `CLAUDE.md`（现状、实测硬事实、决策表）
- Modify: `README.md`（数据字段说明、「不存 xsec_token」那一行）
- Modify: `docs/superpowers/specs/2026-08-03-xhs-archiver-design.md`（加一节，并删掉作废说法）

- [ ] **Step 1: 找出所有需要改的地方**

Run:
```bash
grep -rn "xsec_token\|回访\|作者主页链接" README.md CLAUDE.md docs/superpowers/specs/2026-08-03-xhs-archiver-design.md
```

至少会命中 `README.md:59` 的「不存 `xsec_token` | 它会过期，落盘只是让 diff 变脏；`file_id` 才是长期有效的图片凭据」和 `CLAUDE.md` 决策表里对应的那行。

- [ ] **Step 2: 改 `CLAUDE.md`**

「现状」段落里，在作者卡片那一条后面追加：

```markdown
- **随笔记采集分享链接**（分享面板 →「复制链接」的产出），进 `note.json` 的 `share_url`；浏览页详情栏的原文链接改用它。设计见 `docs/superpowers/specs/2026-08-06-share-link-design.md`
```

「实测硬事实」里新增一组（放在作者悬浮卡片那组后面）：

```markdown
分享链接（同样是登录页实测）：

- **不带 `xsec_token` 的 `/explore/{id}` 已经 404**（`error_code=300031 当前笔记暂时无法浏览`）。所以 `note.json` 里的 `url` 字段点不开，回访原帖必须靠带 token 的分享链接。这条推翻了原先「回访靠 `note_id` + 作者主页链接」的说法。
- **「复制链接」写进剪贴板的是一整段口令文案**，不是纯 URL：`61 【标题 - 作者 | 小红书…】 😆 <URL>`。开头的数字是分享码，来自面板首次打开时发的 `POST /api/sns/web/share/code`（要签名），同一篇再开面板不再请求。
- **分享按钮是 `.buttons.engage-bar-style .share-wrapper svg`**。只写 `.engage-bar .share-wrapper` 会命中 modal 背后信息流卡片上的分享图标——页面上存在两套 `engage-bar`。
- **只能对 svg 一层派发 click**。对 `.share-wrapper` / `.share-icon-container` / `svg` 三层都派发会连续 toggle 三次，净结果是面板关着，现象看起来像「合成事件对这个组件无效」。这条踩过，别再试一遍。
- **分享面板不需要 hover 祖先链**，与作者卡片相反，一次 click 就够。
- **点完「复制链接」面板不会自动关**，必须再点一次 svg 才收起。
- **`xsec_token` 每次签发都不同**：同一篇从首页 feed 进和从作者主页进拿到的不是同一个值（都是 46 字符）。但跨来源可用——feed 签发的 token 放进 `xsec_source=pc_share` 的分享链接里照常打开。
- **本地拼分享 URL 是可行的但被否决**：除 token 外三个参数都是常量（`source=webshare`、`xhsshare=pc_web`、`xsec_source=pc_share`），token 就是 `raw.xsecToken`，拼出来实测能打开。不这么做是因为 `share/code` 是服务端接口，绕过它等于对平台语义做未经验证的假设。
```

决策表追加四行：

```markdown
| 分享链接靠合成事件让页面自己走完流程 | 不要本地拼 URL——拼得出来，但那是对平台语义的未验证假设 |
| 剪贴板拦截而不真写 | 不要让一次采集覆盖使用者当前的剪贴板内容 |
| 分享面板由谁开由谁关 | 使用者自己点开的面板不要动；不要「一律关掉」 |
| 分享链接采不到不阻断归档 | 不要把它算进 `partial`，也不要写空串占位 |
```

同时**删掉**决策表里「不存 `xsec_token` / 它会过期。想回访原帖靠 `note_id` + 作者主页链接」这一行，换成：

```markdown
| 顶层 `url` 不带 `xsec_token`，带 token 的地址单独放 `share_url` | 不要把 token 拼进 `url`——它是笔记的稳定身份。也不要因此以为仓库里没有 token：`raw` 里一直有 |
```

- [ ] **Step 3: 改 `README.md`**

把第 59 行那条决策改成：

```markdown
| 顶层 `url` 不带 `xsec_token`，另存 `share_url` | `url` 是笔记的稳定身份，`share_url` 是当下能点开的入口（token 会过期）；`file_id` 才是长期有效的图片凭据 |
```

并在 `note.json` 的字段说明里，`url` 后面补上 `share_url`：

```markdown
| `share_url` | 分享面板「复制链接」产出的地址，带 `xsec_token`。**会过期**，每次重采都会变。采不到时整个字段缺席 |
```

> 按 `README.md` 里现有表格的实际列数与措辞调整这两行的格式，不要照搬列数。

- [ ] **Step 4: 改主设计文档**

在 `docs/superpowers/specs/2026-08-03-xhs-archiver-design.md` 里：

1. 找到 `note.json` 的字段清单，在 `url` 后面加 `share_url`（可选字段，采不到时缺席）。
2. **删掉**「不存 `xsec_token`，想回访原帖靠 `note_id` + 作者主页链接」的说法——实测已推翻，按项目约定推翻某个结论时把旧说法直接删掉，不留着。
3. 加一节指向新 spec：

```markdown
### 分享链接

采集时通过合成事件让页面自己走完「分享 →「复制链接」」，把产出的地址记进
`note.json` 的 `share_url`。完整设计见
`docs/superpowers/specs/2026-08-06-share-link-design.md`。
```

- [ ] **Step 5: 检查没有残留的作废说法并提交**

Run:
```bash
grep -rn "回访原帖靠\|note_id.*作者主页链接" README.md CLAUDE.md docs/superpowers/specs/
```
Expected: 只在新 spec 里作为「已作废」的引用出现，其他地方无命中

Run: `npm test`
Expected: 全绿

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-08-03-xhs-archiver-design.md
git commit -m "docs: 同步分享链接采集的事实与决策

删掉「回访原帖靠 note_id + 作者主页链接」——实测不带 xsec_token 的
/explore/{id} 已经 404，这条前提不成立了。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 真实页面端到端验收

前面全是 Vitest。这一步必须在真实登录页面上做，agent 做不了全部，需要使用者参与。

**Files:** 无（只改可能暴露出来的 bug）

**Interfaces:**
- Consumes: 全部
- Produces: 无

- [ ] **Step 1: 构建并加载扩展**

Run: `npm run build`

请使用者在 `chrome://extensions` 里加载 `dist/`（或重新加载已有的那份）。

- [ ] **Step 2: 逐条走验收清单**

在真实登录的小红书上，对**一篇图文笔记**依次确认：

1. 打开笔记 → 侧边栏识别成可采集
2. 点采集 → 动作区先显示「正在读取作者信息…」，再显示「正在读取分享链接…」
3. 读分享链接期间，页面上分享面板弹出后**自动收起**，不留在屏幕上
4. **使用者的剪贴板没有被改动**（采集前先复制一段别的文字，采集后粘贴出来确认还是原来那段）
5. 结果卡里「分享链接」一行显示「已记录」
6. 打开 `note.json`，确认 `share_url` 存在、紧跟在 `url` 后面、含 `xsec_token`
7. 把 `share_url` 粘到地址栏，确认能打开这篇笔记
8. 打开浏览页 → 这篇的详情栏 →「小红书原文 ↗」指向 `share_url` 且能打开

再对**三种入口**各验一遍第 2、3、5 条：独立页 `/explore/{id}`、首页 modal、搜索 modal。

再验两个边界：

9. 采集前**自己先点开分享面板**，然后点采集 → 采集结束后面板**仍然开着**（不属于我们的状态不动它）
10. 找一篇**老数据**（`note.json` 里没有 `share_url`）在浏览页打开 → 原文链接回退到 `url`，页面不报错

- [ ] **Step 3: 记录实测结果**

把每一条的结果如实记下来。任何一条不符预期都要先 `superpowers:systematic-debugging` 定位再改，不要凭猜测改选择器或延时。

- [ ] **Step 4: 若有修改，补测试并提交**

任何在这一步暴露的问题，都要先补一个能复现它的失败测试再修，并把新学到的实测事实写进 `CLAUDE.md`。

```bash
git add -A
git commit -m "fix: <实测中暴露的具体问题>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec 覆盖检查**（逐节对照 `2026-08-06-share-link-design.md`）：

| Spec 节 | 实现它的 Task |
|---|---|
| §1 目标 | 1–6 |
| §2 已作废的项目事实 | 7 |
| §3.1 口令文案形态 | 1（测试 fixture 用的就是实测形态） |
| §3.2 否决本地拼接 | 2（走 UI）、7（决策表） |
| §3.3 触发序列 | 2 |
| §3.4 token 性质 | 7（文档） |
| §4.1 流程 | 2 |
| §4.2 剪贴板拦截与还原 | 2 |
| §4.3 面板状态还原 | 2 |
| §4.4 ShareDiag | 2 |
| §4.5 失败分类 + ShareReadResult | 2 |
| §5 extractShareUrl | 1 |
| §6 落盘（含 6.1 diff、6.2 token 澄清） | 3、7 |
| §7.1 类型 | 3 |
| §7.2 sidepanel | 4、5 |
| §7.3 浏览页 | 6 |
| §8 失败即缺席 | 3（缺席）、5（不阻断） |
| §9 测试 | 1、2、3、4、6 |
| §10 明确不做 | 全程未涉及 |
| §11 已知代价 | 7（文档）、8（验收第 3、4 条） |

无缺口。Spec 里没有提到的 Task 8（真实页面验收）是本项目的既有约定（主计划 Task 13 也是这个形态），保留。

**占位符扫描**：无未定项、无「同 Task N」式的省略、无「加上适当的错误处理」式的空话。每个代码步骤都给了可直接落地的完整代码。Task 6 Step 1 原先对 `row-meta.test.ts` 的 fixture 写法留了模糊指示，自查时已核对该文件并改成实际存在的 `noteJson(over)` / `A` / `DS` / `ref`。

**类型一致性**：

- `ShareUrlFailure` / `ShareUrlResult` / `extractShareUrl` —— Task 1 定义，Task 4、5 使用，名字一致
- `ShareReadFailure` / `ShareReadResult` / `ShareDiag` / `readShareViaTab` —— Task 2 定义，Task 4、5 使用，名字一致
- `ShareOutcome` —— Task 4 定义，Task 5 使用
- `pageStep: 'author' | 'share' | null` —— Task 4 定义 prop，Task 5 提供 state，字面量一致
- `ExtractedNote.shareUrl`（驼峰）vs `NoteRecord.share_url`（下划线）—— 刻意如此：前者是内存类型、后者是落盘 key，与项目里 `noteId`/`note_id` 的既有约定一致
- `NoteDetail.shareUrl` 是 `string` 且缺省 `''`（不是可选），与 `NoteDetail.url` 同形 —— Task 6 定义与使用一致
- `readShareViaTab(tabId)` 不收 `expectedNoteId` —— Task 2 的 Interfaces 与 Task 5 的调用一致

无不一致。
