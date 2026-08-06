# 采集开关与看图器缩放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让使用者能在侧边栏关掉「作者信息」「分享链接」这两步采集，并让浏览页的大图完整显示且可自由缩放。

**Architecture:** 两块互不相干的改动。第一块在 `src/core/settings.ts` 加两个布尔字段，侧边栏顶栏腾出位置放设置入口，`doArchive` 按开关跳过对应的页面交互步骤，结果类型从「成功/失败」两态扩成「成功/跳过/失败」三态。第二块把 `Lightbox` 的自研布局换成 `react-zoom-pan-pinch`，fit 交给 CSS 的 `object-fit: contain`，缩放平移交给库。

**Tech Stack:** TypeScript · React 19 · Vitest（`environment: 'node'`，靠 `renderToStaticMarkup` 做组件测试）· `react-zoom-pan-pinch@4`

## Global Constraints

这些约束来自 `CLAUDE.md` 与设计文档，**每个任务都适用**：

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。
- **测试文件必须是 `.ts` 不是 `.tsx`**。`vitest.config.ts` 的 `include` 是 `['tests/**/*.test.ts']`，`.tsx` 根本不会被收集。组件测试一律用 `createElement` + `renderToStaticMarkup`，不写 JSX。
- **Vitest 环境是 `node`**，没有 `document`。任何在模块顶层碰 DOM 的依赖都不能被测试传递性 import（Task 6 有一处，已在该任务内处理）。
- **核心层不碰 DOM 和 chrome API**。`src/core/` 下依赖靠参数注入。碰 `chrome.*` 的代码只出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **代码注释用中文，写「为什么」不写「做了什么」。**
- **改了行为就同步改文档，与代码放在同一个 commit 里。** 不留旧说法。
- **每个任务结束提交一次**，commit message 见各任务最后一步。
- **不直接往 main push**，全部经 PR 合并。PR 标题格式 `<type>: <这次改动让什么变得不一样>`，中文、不带句号、50 字以内，写给使用者看。
- 采集开关的默认值是 **`true`（两个都开）**，缺 key 时也必须读成 `true`。
- 看图器的 `maxScale` 是 **8**，`minScale` 是 **1**（因为库的 `scale=1` 已经是「完整显示」）。

---

## File Structure

**新建：**

| 文件 | 职责 |
|---|---|
| `tests/sidepanel/capture-setup.test.ts` | `CaptureSetup` 的渲染测试 |

**修改：**

| 文件 | 改什么 |
|---|---|
| `src/core/settings.ts` | `Settings` 加 `captureAuthor` / `captureShare`，缺 key 读成 `true` |
| `tests/core/settings.test.ts` | 现有 3 处 `toEqual` 断言要补新字段，另加 3 条新用例 |
| `src/sidepanel/components/NoteView.tsx` | `AuthorOutcome` / `ShareOutcome` 改三态，`Result` 按三态渲染 |
| `tests/sidepanel/note-view.test.ts` | 全部断言从 `ok` 形式改成 `kind` 形式，另加 2 条 skipped 用例 |
| `src/sidepanel/components/Icons.tsx` | 新增 `IconGear` |
| `src/sidepanel/components/Setup.tsx` | 新增 `CaptureSetup` |
| `src/sidepanel/App.tsx` | 顶栏结构、`editingCapture` 状态、设置接线、`doArchive` 跳过逻辑 |
| `src/sidepanel/panel.css` | 删 `.pt-brand`，加 `.pt-chips`、`.switch` 系列 |
| `src/browser/components/Lightbox.tsx` | 整体改用 `react-zoom-pan-pinch` |
| `src/browser/browser.css` | `.bw-lb-img` 脱掉坏掉的 grid，加 `.bw-lb-zoom` |
| `tests/browser/detail-pane.test.ts` | 加 jsdom 环境注释（见 Task 6 解释） |
| `package.json` | 加 `react-zoom-pan-pinch` 依赖 |
| `CLAUDE.md` | 决策表 2 条、实测硬事实 2 条 |

---

# 第一部分：采集开关

## Task 1: `Settings` 加两个采集开关字段

**Files:**
- Modify: `src/core/settings.ts:8-11`（接口）、`:44`（KEYS）、`:46-52`（loadSettings）
- Test: `tests/core/settings.test.ts:66-90`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `Settings` 接口新增 `captureAuthor: boolean` 与 `captureShare: boolean`。`loadSettings(area)` 在 storage 缺这两个 key 时返回 `true`。`saveSettings(area, s)` 要求调用方传全量 `Settings` 对象。

- [ ] **Step 1: 先改现有测试的断言，让它们反映新字段**

`tests/core/settings.test.ts` 里有 3 处 `toEqual` 会因为多出字段而失败。把它们改成：

```ts
  it('空存储返回 null 字段，两个采集开关默认打开', async () => {
    expect(await loadSettings(fakeArea())).toEqual({
      collector: null, datasetPath: null, captureAuthor: true, captureShare: true,
    });
  });
  it('往返一致', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'zach/2026-08-03', captureAuthor: true, captureShare: true,
    });
    expect(await loadSettings(area)).toEqual({
      collector: 'zach', datasetPath: 'zach/2026-08-03', captureAuthor: true, captureShare: true,
    });
  });
  it('旧的带日期路径会原样恢复', async () => {
    const area = fakeArea();
    Object.assign(area.data, { collector: 'zach', datasetPath: 'collected/2026-08-04' });
    expect(await loadSettings(area)).toEqual({
      collector: 'zach', datasetPath: 'collected/2026-08-04',
      captureAuthor: true, captureShare: true,
    });
  });
```

同一个 describe 里那两条 `rejects.toThrow` 用例也要补字段，否则 TS 类型不通：

```ts
  it('拒绝保存非法采集者 ID', async () => {
    await expect(saveSettings(fakeArea(), {
      collector: '张三', datasetPath: null, captureAuthor: true, captureShare: true,
    })).rejects.toThrow(/采集者/);
  });
  it('拒绝保存非法数据集路径', async () => {
    await expect(saveSettings(fakeArea(), {
      collector: 'zach', datasetPath: '/bad', captureAuthor: true, captureShare: true,
    })).rejects.toThrow(/数据集路径/);
  });
```

- [ ] **Step 2: 追加三条新用例**

放在同一个 `describe('loadSettings / saveSettings')` 块的末尾：

```ts
  // 已经在用的人 storage 里没有这两个 key。读成 false 等于静默关掉他们本来就有的能力。
  it('老用户没有这两个 key 时读成打开', async () => {
    const area = fakeArea();
    Object.assign(area.data, { collector: 'zach', datasetPath: 'collected' });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(true);
    expect(s.captureShare).toBe(true);
  });

  it('关掉的开关能存能读回', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'collected', captureAuthor: false, captureShare: false,
    });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(false);
    expect(s.captureShare).toBe(false);
  });

  // 只关一个是最常见的用法：平台改版通常只弄坏其中一步。
  it('两个开关互相独立', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'collected', captureAuthor: false, captureShare: true,
    });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(false);
    expect(s.captureShare).toBe(true);
  });
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: FAIL。`toEqual` 那几条报对象不匹配（实际结果没有 `captureAuthor` / `captureShare`），新加的三条报 `expected undefined to be true`。

- [ ] **Step 4: 改实现**

`src/core/settings.ts`，接口加两个字段：

```ts
export interface Settings {
  collector: string | null;
  datasetPath: string | null;
  /** 关掉就跳过作者悬浮卡片那一步。平台改版把它弄坏时的逃生口。 */
  captureAuthor: boolean;
  /** 关掉就跳过分享面板那一步。 */
  captureShare: boolean;
}
```

`KEYS` 加两项：

```ts
const KEYS = ['collector', 'datasetPath', 'captureAuthor', 'captureShare'];
```

`loadSettings` 补两行。**缺 key 一律读成 `true`**：

```ts
export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const raw = await area.get(KEYS);
  return {
    collector: typeof raw.collector === 'string' ? raw.collector : null,
    datasetPath: typeof raw.datasetPath === 'string' ? raw.datasetPath : null,
    // 老用户的 storage 里没有这两个 key。默认成 false 等于在他们不知情时
    // 关掉本来就有的能力，所以缺失一律当成开着。
    captureAuthor: typeof raw.captureAuthor === 'boolean' ? raw.captureAuthor : true,
    captureShare: typeof raw.captureShare === 'boolean' ? raw.captureShare : true,
  };
}
```

`saveSettings` 的 `area.set` 补两个字段（校验不用动，布尔值没什么可校验的）：

```ts
  await area.set({
    collector: s.collector,
    datasetPath: s.datasetPath,
    captureAuthor: s.captureAuthor,
    captureShare: s.captureShare,
  });
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: PASS，全部用例绿。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: PASS。`src/sidepanel/App.tsx` 里两处 `saveSettings` 调用现在少传两个字段，TS 类型上不一致，但 Vitest 用 esbuild 只做转译不做类型检查，所以测试仍然全绿。**这个不一致在 Task 5 修好**，不要在这里顺手改——App.tsx 还没有这两个字段的 state。

- [ ] **Step 7: 提交**

```bash
git add src/core/settings.ts tests/core/settings.test.ts
git commit -m "feat: 设置里新增作者信息与分享链接的采集开关字段

两个开关默认打开。老用户 storage 里没有这两个 key，缺失时一律
读成 true——读成 false 等于在他们不知情时关掉本来就有的能力。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `Result` 的作者与分享结果改成三态

**Files:**
- Modify: `src/sidepanel/components/NoteView.tsx:15-26`（类型）、`:162-180`（渲染）
- Modify: `src/sidepanel/App.tsx:333-334`（初值）、`:343-361`（author 赋值）、`:367-385`（share 赋值）
- Test: `tests/sidepanel/note-view.test.ts`（整个文件）

**Interfaces:**
- Consumes: Task 1 的 `Settings`（本任务不直接用，但同属一条改动链）
- Produces:
  ```ts
  export type AuthorOutcome =
    | { kind: 'ok'; fans: number; interaction: number; approximate: boolean }
    | { kind: 'skipped' }
    | { kind: 'fail'; reason: AuthorReadFailure };

  export type ShareOutcome =
    | { kind: 'ok'; url: string }
    | { kind: 'skipped' }
    | { kind: 'fail'; reason: ShareReadFailure | ShareUrlFailure };
  ```
  Task 5 的 `doArchive` 会构造这两个类型的值。

- [ ] **Step 1: 把现有测试全部改成 `kind` 形式，并加两条 skipped 用例**

`tests/sidepanel/note-view.test.ts` 整个文件替换成：

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Result, type ArchiveOutcome } from '../../src/sidepanel/components/NoteView';
import type { ExtractedComments } from '../../src/types';

const comments: ExtractedComments = {
  declaredTotal: 10, collectedCount: 10, complete: true, hasMore: false, list: [],
};

function outcome(
  author: ArchiveOutcome['author'],
  share: ArchiveOutcome['share'] = { kind: 'ok', url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T' },
): ArchiveOutcome {
  return {
    mode: 'new', status: 'complete', path: 'collected/n1', failures: [],
    imageCount: 3, comments, commentImageFailures: [], author, share,
  };
}

describe('Result 里的作者信息', () => {
  it('采到时显示粉丝与获赞收藏', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'ok', fans: 384, interaction: 1500, approximate: false }) }),
    );
    expect(html).toContain('384');
    expect(html).toContain('1,500');
    expect(html).not.toContain('约');
  });

  // 大号的计数是平台模糊过的，不能让人以为那是精确值
  it('approximate 时标注「约」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'ok', fans: 100000, interaction: 1000, approximate: true }) }),
    );
    expect(html).toContain('约');
  });

  // 采不到不阻断归档，但必须如实说，别让人以为采到了
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'fail', reason: 'no_element' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('作者信息未采到');
    expect(html).toContain('重采这篇可以再试');
  });

  // 「关掉了」跟「采失败了」是两回事：前者是使用者的决定，不该带失败措辞，
  // 更不该劝人重采——重采还是会跳过。
  it('关掉时说明是设置里关的，不显示失败措辞', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'skipped' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('已在设置中关闭');
    expect(html).not.toContain('未采到');
    expect(html).not.toContain('重采这篇可以再试');
  });
});

describe('Result 里的分享链接', () => {
  const okAuthor = { kind: 'ok', fans: 1, interaction: 1, approximate: false } as const;

  it('采到时说明已记录', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, {
        kind: 'ok', url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T',
      }),
    }));
    expect(html).toContain('分享链接');
    expect(html).toContain('已记录');
  });

  // 采不到不阻断归档，但必须如实说
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'fail', reason: 'no_panel' }),
    }));
    expect(html).toContain('采集完成');
    expect(html).toContain('分享链接未采到');
    expect(html).toContain('分享面板没弹出来');
    expect(html).toContain('重采这篇可以再试');
  });

  it('解析层的失败也能原样说出来', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'fail', reason: 'id_mismatch' }),
    }));
    expect(html).toContain('链接指向别的笔记');
  });

  it('关掉时说明是设置里关的', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'skipped' }),
    }));
    expect(html).toContain('采集完成');
    expect(html).toContain('已在设置中关闭');
    expect(html).not.toContain('未采到');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: FAIL。`Result` 还在读 `outcome.author.ok`，传进去的对象没有 `ok` 字段，走进 falsy 分支，于是「采到」那几条断言失败；skipped 两条报找不到「已在设置中关闭」。

- [ ] **Step 3: 改 `NoteView.tsx` 的类型**

替换 `src/sidepanel/components/NoteView.tsx:15-26` 那两个类型定义：

```ts
/**
 * 作者卡片这一步的结果。三态：采到、被使用者关掉、采失败。
 * 「关掉」不能塞进 AuthorReadFailure——那个枚举描述的是页面交互怎么失败的，
 * 而关掉根本没发生过交互，混进去会让文案表退化成什么都往里塞的字典。
 */
export type AuthorOutcome =
  | { kind: 'ok'; fans: number; interaction: number; approximate: boolean }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: AuthorReadFailure };

/**
 * 分享链接这一步的结果。失败原因跨两层：页面层没点开面板是一回事，
 * 解析层发现链接指向别的笔记是另一回事，两者的排查方向完全不同。
 */
export type ShareOutcome =
  | { kind: 'ok'; url: string }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: ShareReadFailure | ShareUrlFailure };
```

- [ ] **Step 4: 改 `Result` 的渲染**

替换 `src/sidepanel/components/NoteView.tsx` 里 `<dt>作者</dt>` 到 `</dd>`（分享那段）之间的内容：

```tsx
        <dt>作者</dt>
        <dd>
          {outcome.author.kind === 'ok' ? (
            <>
              {outcome.author.approximate && '约 '}
              {outcome.author.fans.toLocaleString('zh-CN')} 粉丝 ·{' '}
              {outcome.author.approximate && '约 '}
              {outcome.author.interaction.toLocaleString('zh-CN')} 获赞与收藏
            </>
          ) : outcome.author.kind === 'skipped' ? (
            <span className="hint">已在设置中关闭</span>
          ) : (
            <>作者信息未采到：{AUTHOR_FAIL[outcome.author.reason]}。重采这篇可以再试。</>
          )}
        </dd>
        <dt>分享链接</dt>
        <dd>
          {outcome.share.kind === 'ok' ? (
            '已记录'
          ) : outcome.share.kind === 'skipped' ? (
            <span className="hint">已在设置中关闭</span>
          ) : (
            <>分享链接未采到：{SHARE_FAIL[outcome.share.reason]}。重采这篇可以再试。</>
          )}
        </dd>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: PASS，10 条全绿。

- [ ] **Step 6: 把 `App.tsx` 的构造点同步到新形状**

只改形状，**不加跳过逻辑**（那是 Task 5）。

`src/sidepanel/App.tsx:333-334` 的初值：

```ts
    // 初值就是失败态：任何一条岔路（比如拿不到 tabId）都不该让后面的 archive
    // 拿到未赋值的变量，而那种情况是真失败，不是 skipped。
    let author: AuthorOutcome = { kind: 'fail', reason: 'inject_failed' };
    let share: ShareOutcome = { kind: 'fail', reason: 'inject_failed' };
```

author 那段的三处赋值：

```ts
          if (card) {
            noteToWrite.author = { ...plan.note.author, ...card };
            author = {
              kind: 'ok', fans: card.fans, interaction: card.interaction,
              approximate: card.approximate,
            };
          } else {
            // 卡片回来了但三个计数一个都没有，等同于没采到。
            author = { kind: 'fail', reason: 'timeout' };
          }
        } else {
          author = { kind: 'fail', reason: read.reason };
        }
      }
    } catch (e) {
      // 读作者是附属步骤，它自己出错绝不能把整篇采集带下水。
      author = { kind: 'fail', reason: 'page_error' };
    }
```

share 那段同理：

```ts
          if (parsed.ok) {
            noteToWrite.shareUrl = parsed.url;
            share = { kind: 'ok', url: parsed.url };
          } else {
            share = { kind: 'fail', reason: parsed.reason };
          }
        } else {
          share = { kind: 'fail', reason: read.reason };
        }
      }
    } catch (e) {
      share = { kind: 'fail', reason: 'page_error' };
    } finally {
      setPageStep(null);
    }
```

- [ ] **Step 7: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿。

- [ ] **Step 8: 提交**

```bash
git add src/sidepanel/components/NoteView.tsx src/sidepanel/App.tsx tests/sidepanel/note-view.test.ts
git commit -m "refactor: 采集结果区分「关掉了」与「采失败了」

作者与分享链接的结果从两态改成三态。「使用者关掉了」不能塞进
AuthorReadFailure/ShareReadFailure——那两个枚举描述的是页面交互
怎么失败的，而关掉根本没发生过交互，混进去会让文案表退化成一张
什么都往里塞的字典。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 顶栏去掉品牌块，两个 chip 靠左

**Files:**
- Modify: `src/sidepanel/App.tsx:437-460`（header 结构）
- Modify: `src/sidepanel/panel.css:12-16`（删 `.pt-brand`）

**Interfaces:**
- Consumes: 无
- Produces: `.pt-chips` 容器类，Task 5 会往它右边加齿轮按钮。

这一步纯布局，没有可写的单元测试（`App` 组件顶层就调 `chrome.tabs.query`，node 环境跑不起来）。验收靠 Step 4 的人工检查。

- [ ] **Step 1: 改 header 结构**

替换 `src/sidepanel/App.tsx` 里 `<header className="pt-top">` 整块：

```tsx
      <header className="pt-top">
        {/* 这个容器即使没有 chip 也要渲染：撑开右侧图标靠的是它身上的
            margin-right:auto，跟着 configured 一起消失的话，首次配置阶段
            三个图标会整体塌到左边。 */}
        <div className="pt-chips">
          {configured && (
            <>
              <button className="chip" title="更换数据仓库目录" onClick={() => void pickRoot()}>
                <span className="k">仓库</span>
                <span className="v">{rootName}</span>
              </button>
              <button className="chip" title="更改采集者 ID" onClick={() => setEditingCollector(true)}>
                <span className="k">采集者</span>
                <span className="v">{collector}</span>
              </button>
            </>
          )}
        </div>
        {configured && (
          <button className="icon-btn" title="浏览数据集" onClick={() => void openBrowser()}>
            <IconBrowse />
          </button>
        )}
        <button className="icon-btn" title="重新读取页面" onClick={() => void refresh()}>
          <IconRefresh />
        </button>
      </header>
```

- [ ] **Step 2: 改样式**

`src/sidepanel/panel.css`，**删掉** `.pt-brand` 和 `.pt-brand .dot` 两条规则（第 12–16 行），换成：

```css
/* 即使没有 chip 也占位，右侧图标靠它撑到最右 */
.pt-chips { display: flex; align-items: center; gap: 8px; margin-right: auto; min-width: 0; }
```

- [ ] **Step 3: 确认没有别处还在引用被删的类**

Run: `grep -rn "pt-brand" src/ tests/`
Expected: 无输出。若有命中，一并清掉。

- [ ] **Step 4: 构建并人工看一眼**

Run: `npm run build`
Expected: 构建成功，无报错。

在 `chrome://extensions` 加载 `dist/` 后打开侧边栏，确认两件事：
1. 配置完成的状态下，「仓库」「采集者」两个 chip 靠左，浏览与刷新两个图标靠右
2. **还没选目录的状态下**（可以新开一个 Chrome 配置文件，或临时在 DevTools 里清掉 storage），刷新图标仍然靠在最右边，没有塌到左边

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿（这一步不碰被测代码，确认没误伤）。

- [ ] **Step 6: 提交**

```bash
git add src/sidepanel/App.tsx src/sidepanel/panel.css
git commit -m "refactor: 侧边栏顶栏去掉标题，两个标签靠左

侧边栏只有一个，标题不承载信息，腾出的横向空间留给右侧图标。
chip 容器即使为空也渲染——撑开右侧图标靠的是它身上的
margin-right:auto，跟着 configured 一起消失会让首次配置阶段的
图标塌到左边。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `CaptureSetup` 设置页组件

**Files:**
- Modify: `src/sidepanel/components/Setup.tsx`（末尾追加组件）
- Modify: `src/sidepanel/components/Icons.tsx`（追加 `IconGear`）
- Modify: `src/sidepanel/panel.css`（追加 `.switch` 系列）
- Test: `tests/sidepanel/capture-setup.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  ```tsx
  export function CaptureSetup(props: {
    captureAuthor: boolean;
    captureShare: boolean;
    onChange(next: { captureAuthor: boolean; captureShare: boolean }): void;
    onBack(): void;
  }): JSX.Element;

  export function IconGear(): JSX.Element;
  ```
  Task 5 会把它接进 `App.tsx`。

- [ ] **Step 1: 写失败的测试**

新建 `tests/sidepanel/capture-setup.test.ts`：

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CaptureSetup } from '../../src/sidepanel/components/Setup';

function render(captureAuthor: boolean, captureShare: boolean) {
  return renderToStaticMarkup(createElement(CaptureSetup, {
    captureAuthor, captureShare,
    onChange: vi.fn(), onBack: vi.fn(),
  }));
}

describe('CaptureSetup', () => {
  it('两个开关都在，勾选状态跟着 props 走', () => {
    const html = render(true, false);
    expect(html).toContain('采集作者信息');
    expect(html).toContain('采集分享链接');
    // 开着的那个 checked、关着的那个不 checked
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('checked');
    expect(boxes[1]).not.toContain('checked');
  });

  // 关掉之后使用者最担心的就是「我以前采的会不会没了」，必须当场回答
  it('说明关掉的后果，并说清不影响已采过的笔记', () => {
    const html = render(true, true);
    expect(html).toContain('已经采过的笔记不受影响');
  });

  // 这一页没有「保存」，一拨就生效。不写清楚会让人以为改了没存
  it('只有返回按钮，没有保存按钮', () => {
    const html = render(true, true);
    expect(html).toContain('返回');
    expect(html).not.toContain('保存');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sidepanel/capture-setup.test.ts`
Expected: FAIL，报 `CaptureSetup is not a function` 或导入为 undefined。

- [ ] **Step 3: 加 `IconGear`**

在 `src/sidepanel/components/Icons.tsx` 末尾追加（沿用文件顶部的 `stroke` 常量）：

```tsx
export function IconGear() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.07a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}
```

- [ ] **Step 4: 写 `CaptureSetup`**

在 `src/sidepanel/components/Setup.tsx` 末尾追加。文件顶部的 import 要补上 `IconGear`：

```tsx
import { IconFolder, IconGear, IconId, IconPath } from './Icons';
```

组件本体：

```tsx
/**
 * 采集开关。作者卡片与分享链接这两步都靠合成事件驱动页面自己走流程，
 * 对小红书的 DOM 结构有强依赖——平台改一次前端就可能让这两步各自空转到
 * 超时。这一页是那时候的逃生口，不必等插件发新版。
 *
 * 这里刻意没有「保存」按钮：同目录的 CollectorSetup / PathSetup 有输入校验、
 * 存在「填了一半不合法」的中间态，所以需要提交语义；布尔开关没有这回事，
 * 多一步保存只是让使用者多点一次。
 */
export function CaptureSetup({
  captureAuthor, captureShare, onChange, onBack,
}: {
  captureAuthor: boolean;
  captureShare: boolean;
  onChange(next: { captureAuthor: boolean; captureShare: boolean }): void;
  onBack(): void;
}) {
  return (
    <div className="pt-body">
      <div className="empty">
        <IconGear />
        <h2>采集设置</h2>
        <p>
          这两步都要驱动小红书页面自己走一遍流程。哪一步被平台改坏了，
          在这里关掉就能让采集立刻恢复顺畅，不用等插件更新。
        </p>

        <label className="switch">
          <input
            type="checkbox"
            checked={captureAuthor}
            onChange={(e) => onChange({ captureAuthor: e.target.checked, captureShare })}
          />
          <span className="switch-text">
            <b>采集作者信息</b>
            <i>简介、关注、粉丝、获赞与收藏。关掉后不再让作者卡片在页面上闪现。</i>
          </span>
        </label>

        <label className="switch">
          <input
            type="checkbox"
            checked={captureShare}
            onChange={(e) => onChange({ captureAuthor, captureShare: e.target.checked })}
          />
          <span className="switch-text">
            <b>采集分享链接</b>
            <i>能点开原帖的那个地址。关掉后不再弹分享面板，note.json 里不写 share_url。</i>
          </span>
        </label>

        <p className="hint">
          关掉只是跳过这一步，采集会更快，笔记正文、配图、评论照常。
          <b>已经采过的笔记不受影响</b>，仓库里的旧数据不会被改动。
          正常情况下两个都保持开启。
        </p>

        <button className="btn btn-sm" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 加开关样式**

`src/sidepanel/panel.css` 末尾追加：

```css
/* ── 采集开关 ─────────────────────────────────────────── */
.switch {
  width: 100%; margin-top: 10px; display: flex; gap: 9px; align-items: flex-start;
  text-align: left; padding: 9px 10px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--surface); cursor: pointer;
}
.switch:hover { border-color: var(--line-2); }
.switch input { flex: none; margin-top: 2px; accent-color: var(--ink); }
.switch-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.switch-text b { font-size: 12.5px; font-weight: 600; color: var(--ink); }
.switch-text i { font-style: normal; font-size: 11px; color: var(--ink-3); line-height: 1.5; }
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/sidepanel/capture-setup.test.ts`
Expected: PASS，3 条全绿。

若「只有返回按钮，没有保存按钮」那条失败，检查文案里是不是别处出现了「保存」二字——这条断言是全文匹配。

- [ ] **Step 7: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿。

- [ ] **Step 8: 提交**

```bash
git add src/sidepanel/components/Setup.tsx src/sidepanel/components/Icons.tsx src/sidepanel/panel.css tests/sidepanel/capture-setup.test.ts
git commit -m "feat: 新增采集设置页，可关掉作者信息与分享链接的采集

这一页刻意没有保存按钮：布尔开关不存在「填了一半不合法」的中间态，
提交语义只是让使用者多点一次。文案当场回答「已经采过的笔记会不会
受影响」——那是关掉开关时最容易担心的事。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 齿轮入口接线，`doArchive` 按开关跳过

**Files:**
- Modify: `src/sidepanel/App.tsx`（import、state、设置持久化、header、分支渲染、`doArchive`）
- Modify: `CLAUDE.md`（现状段、决策表）

**Interfaces:**
- Consumes: Task 1 的 `Settings.captureAuthor/captureShare`；Task 2 的 `AuthorOutcome`/`ShareOutcome` 三态；Task 4 的 `CaptureSetup`、`IconGear`
- Produces: 完整可用的采集开关（第一部分收尾）

- [ ] **Step 1: 补 import**

`src/sidepanel/App.tsx` 顶部，把 `Setup` 的 import 加上 `CaptureSetup`：

```ts
import {
  RootSetup, PermissionSetup, MissingRootSetup, CollectorSetup, PathSetup, CaptureSetup,
} from './components/Setup';
```

`Icons` 的 import 加上 `IconGear`：

```ts
import { IconRefresh, IconBrowse, IconGear } from './components/Icons';
```

- [ ] **Step 2: 加 state**

在 `const [editingPath, setEditingPath] = useState(false);` 下面追加：

```ts
  const [editingCapture, setEditingCapture] = useState(false);
  // 两个采集开关。默认打开，与 loadSettings 的缺省一致。
  const [captureAuthor, setCaptureAuthor] = useState(true);
  const [captureShare, setCaptureShare] = useState(true);
```

- [ ] **Step 3: 恢复设置时读进来**

在恢复设置的 `useEffect` 里，`setCollector(st.collector);` 那行下面追加：

```ts
      setCaptureAuthor(st.captureAuthor);
      setCaptureShare(st.captureShare);
```

- [ ] **Step 4: 补全两处 `saveSettings` 调用，并加一个开关的落盘函数**

`saveCollector` 与 `savePath` 现在少传两个字段（Task 1 Step 6 留下的不一致），补上：

```ts
  async function saveCollector(id: string) {
    // 写入路径不再跟采集者挂钩，所以改 ID 不动路径。还没确认过路径就先别落盘——
    // 存下来会被当成「确认过」，把 need_path 那一步跳掉。
    await saveSettings(chromeLocalArea, {
      collector: id,
      datasetPath: pathConfirmed ? datasetPath : null,
      captureAuthor,
      captureShare,
    });
    setCollector(id);
    setEditingCollector(false);
  }

  async function savePath(value: string) {
    if (!collector) return;
    if (!isValidDatasetPath(value)) return;
    await saveSettings(chromeLocalArea, {
      collector, datasetPath: value, captureAuthor, captureShare,
    });
    setDatasetPath(value);
    setPathConfirmed(true);
    setEditingPath(false);
  }
```

在 `savePath` 下面新增：

```ts
  /** 开关一拨就落盘。这一页没有「保存」，见 CaptureSetup 的说明。 */
  async function saveCapture(next: { captureAuthor: boolean; captureShare: boolean }) {
    setCaptureAuthor(next.captureAuthor);
    setCaptureShare(next.captureShare);
    await saveSettings(chromeLocalArea, {
      collector,
      datasetPath: pathConfirmed ? datasetPath : null,
      ...next,
    });
  }
```

- [ ] **Step 5: 顶栏加齿轮按钮**

在 `header` 里，浏览按钮**之前**插入（顺序：设置 → 浏览 → 刷新）：

```tsx
        {configured && (
          <button className="icon-btn" title="采集设置" onClick={() => setEditingCapture(true)}>
            <IconGear />
          </button>
        )}
```

- [ ] **Step 6: 加分支渲染**

在渲染链最前面加一支——它要排在 `editingCollector` 之前，这样从设置页返回时不会被别的分支抢走：

```tsx
      {editingCapture ? (
        <CaptureSetup
          captureAuthor={captureAuthor}
          captureShare={captureShare}
          onChange={(next) => void saveCapture(next)}
          onBack={() => setEditingCapture(false)}
        />
      ) : editingCollector ? (
```

（原来的 `{editingCollector ? (` 改成上面最后那行，后面所有分支保持不动。）

- [ ] **Step 7: `doArchive` 按开关跳过**

把 author 那一整段包进条件。注意 `setPageStep('author')` 也要进条件里——关掉了还闪一句「正在读取作者信息…」是错的：

```ts
    // 作者卡片：约 1.5–3 秒，期间卡片会在页面上闪现后自动收起。
    // 关掉时整段跳过，连 pageStep 都不设——没发生的事不该在界面上出现。
    if (!captureAuthor) {
      author = { kind: 'skipped' };
    } else {
      setPageStep('author');
      try {
        if (tabId !== undefined) {
          const read = await readAuthorViaTab(tabId, plan.note.author.user_id);
          if (read.ok) {
            const card = extractAuthorCard(read.raw, nowBeijingIso());
            if (card) {
              noteToWrite.author = { ...plan.note.author, ...card };
              author = {
                kind: 'ok', fans: card.fans, interaction: card.interaction,
                approximate: card.approximate,
              };
            } else {
              // 卡片回来了但三个计数一个都没有，等同于没采到。
              author = { kind: 'fail', reason: 'timeout' };
            }
          } else {
            author = { kind: 'fail', reason: read.reason };
          }
        }
      } catch (e) {
        // 读作者是附属步骤，它自己出错绝不能把整篇采集带下水。
        author = { kind: 'fail', reason: 'page_error' };
      }
    }
```

share 那段同样处理。**注意原来的 `finally { setPageStep(null) }`**：跳过时没有 try/finally，所以要保证 `setPageStep(null)` 在两条路上都执行：

```ts
    // 分享链接：让页面自己走完「分享 → 复制链接」。面板会弹出来一两秒，
    // 剪贴板被拦下不真写。解析与身份校验在 core，页面脚本只负责弄出原文。
    if (!captureShare) {
      share = { kind: 'skipped' };
    } else {
      setPageStep('share');
      try {
        if (tabId !== undefined) {
          const read = await readShareViaTab(tabId);
          if (read.ok) {
            const parsed = extractShareUrl(read.text, plan.note.noteId);
            if (parsed.ok) {
              noteToWrite.shareUrl = parsed.url;
              share = { kind: 'ok', url: parsed.url };
            } else {
              share = { kind: 'fail', reason: parsed.reason };
            }
          } else {
            share = { kind: 'fail', reason: read.reason };
          }
        }
      } catch (e) {
        share = { kind: 'fail', reason: 'page_error' };
      }
    }
    // 两条路都要清掉，否则关着开关采集时按钮会一直停在「采集中…」
    setPageStep(null);
```

- [ ] **Step 8: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿。

- [ ] **Step 9: 构建**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 10: 同步 `CLAUDE.md`**

「现状」段的验收期间新增项列表里追加一条：

```markdown
- **作者信息与分享链接的采集可以关掉**：顶栏齿轮 →「采集设置」，两个开关默认都开。
  关掉只是跳过该步，不阻断归档、不影响仓库里已采过的笔记。设计见
  `docs/superpowers/specs/2026-08-06-capture-toggles-and-lightbox-design.md`
```

决策表追加一行：

```markdown
| 采集开关默认开，关掉只跳过该步 | 不要把「关掉了」塞进 `AuthorReadFailure`/`ShareReadFailure`——那两个枚举描述的是页面交互怎么失败的，而关掉根本没发生过交互。也不要因为关掉就少写 `note.json` 里 `AuthorBase` 那部分身份字段 |
```

- [ ] **Step 11: 提交**

```bash
git add src/sidepanel/App.tsx CLAUDE.md
git commit -m "feat: 顶栏加设置入口，关掉的采集步骤会被整段跳过

关掉时连 pageStep 都不设——没发生的事不该在界面上闪一句「正在
读取…」。setPageStep(null) 从 finally 挪到两条路的汇合点，否则
关着开关采集时按钮会一直停在「采集中…」。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 12: 真实页面验收**

在 `chrome://extensions` 重新加载 `dist/`，然后：

1. 打开一篇图文笔记，顶栏点齿轮 → 关掉「采集作者信息」→ 返回
2. 点采集，确认：页面上**不再闪出作者卡片**、界面上不出现「正在读取作者信息…」、结果卡里「作者」一行显示灰字「已在设置中关闭」、「分享链接」一行仍然显示「已记录」
3. 打开写入的 `note.json`，确认 `author` 里没有 `fans`/`interaction`/`desc`/`card_fetched_at`，但 `user_id`/`nickname` 仍在
4. 两个开关都关掉再采一篇，确认按钮不会卡在「采集中…」
5. 把两个开关都打开，重新加载侧边栏，确认开关状态被记住了

---

# 第二部分：看图器

## Task 6: 看图器改用 `react-zoom-pan-pinch`

**Files:**
- Modify: `package.json`（依赖）
- Modify: `src/browser/components/Lightbox.tsx`（整体重写）
- Modify: `src/browser/browser.css:213-214`（`.bw-lb-img`）+ 追加 `.bw-lb-zoom`
- Modify: `tests/browser/detail-pane.test.ts:1`（加环境注释）
- Modify: `CLAUDE.md`（实测硬事实、决策表）

**Interfaces:**
- Consumes: 无（与第一部分完全独立）
- Produces: `Lightbox` 的 props 签名**不变**，`DetailPane` 的调用点不用动

- [ ] **Step 1: 装依赖**

Run: `npm install react-zoom-pan-pinch@^4.0.4`
Expected: 装上，`package.json` 的 `dependencies` 多一项。

- [ ] **Step 2: 先确认它会不会弄挂现有测试**

Run: `npm test`
Expected: **可能 FAIL**。

原因：这个库在**模块顶层**调用 `styleInject()`，里面是 `document.createElement('style')`。而 `vitest.config.ts` 的 `environment` 是 `'node'`，没有 `document`。`tests/browser/detail-pane.test.ts` import 了 `DetailPane`，`DetailPane` import 了 `Lightbox`，Task 6 之后 `Lightbox` 又 import 这个库——**传递性 import 会让这个测试文件在加载阶段就崩掉**，报 `document is not defined`。

此刻 `Lightbox` 还没改，所以这一步大概率是绿的。记下这个预期，Step 6 会真正撞上它。

- [ ] **Step 3: 重写 `Lightbox.tsx`**

整个文件替换成：

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  TransformWrapper, TransformComponent, useControls, useTransformComponent,
} from 'react-zoom-pan-pinch';
import type { ImageRecord } from '../../types';
import type { NoteRef } from '../../core/browse/types';
import type { ThumbSize } from '../hooks/useThumbnail';

export type LightboxImage = Pick<ImageRecord, 'file' | 'width' | 'height' | 'bytes' | 'source_kind'>;

const MAX_SCALE = 8;

/**
 * 顶栏的缩放控件。必须放在 TransformWrapper 内部——useControls 与
 * useTransformComponent 都从它的 context 取值，摆在外面拿不到。
 */
function ZoomControls({ fitRatio }: { fitRatio: number | null }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const scale = useTransformComponent((c) => c.state.scale);
  // 库的 scale=1 是「完整显示」而不是原始像素（fit 由 CSS 的 object-fit 负责），
  // 所以要乘上 fit 比例才是使用者理解的那个百分比。
  const percent = fitRatio === null ? null : Math.round(scale * fitRatio * 100);
  return (
    <span className="bw-lb-zoom">
      <button onClick={() => zoomOut()} title="缩小">−</button>
      <b>{percent === null ? '—' : `${percent}%`}</b>
      <button onClick={() => zoomIn()} title="放大">+</button>
      <button onClick={() => resetTransform()} title="完整显示">⤢</button>
    </span>
  );
}

/**
 * 换了图就复位。不复位的话上一张放大到 400% 的状态会原样套到下一张身上，
 * 翻图翻到一半会突然看到某张图的局部。
 */
function ResetOnChange({ token }: { token: string }) {
  const { resetTransform } = useControls();
  useEffect(() => { resetTransform(0); }, [token, resetTransform]);
  return null;
}

export function Lightbox({
  noteRef, images, index, onIndex, onClose, thumbUrl,
}: {
  noteRef: NoteRef;
  images: LightboxImage[];
  index: number;
  onIndex(i: number): void;
  onClose(): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      if (e.key === 'ArrowRight') onIndex(Math.min(images.length - 1, index + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex, onClose]);

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cur = images[index];
  // 只有看图器会解原图。它用独立的 LRU(3)，退出后很快被挤掉释放
  const url = cur ? thumbUrl(noteRef, cur.file, 'full') : undefined;

  // 换图时上一张的自然尺寸必须作废，否则百分比会短暂显示上一张的换算结果
  useEffect(() => { setNat(null); }, [url]);

  // 尺寸只能取 naturalWidth：同一个看图器也被评论配图复用，而评论图在
  // comments.json 里记的是展示尺寸（284×367 的图实际 556×717），
  // 拿 ImageRecord 的声明值算，评论图会整批算错。
  const fitRatio = box && nat ? Math.min(box.w / nat.w, box.h / nat.h) : null;

  return (
    <div className="bw-lightbox" onClick={onClose}>
      {/* TransformWrapper 只返回 Context.Provider，不渲染任何 DOM 元素，
          所以夹在这里不会破坏 .bw-lightbox 的 flex 布局。 */}
      <TransformWrapper
        minScale={1}
        maxScale={MAX_SCALE}
        limitToBounds
        centerOnInit
        doubleClick={{ mode: 'toggle' }}
        wheel={{ step: 0.2 }}
      >
        <div className="bw-lb-bar">
          <span>{index + 1} / {images.length}</span>
          <span>{cur ? `${cur.width}×${cur.height} · ${(cur.bytes / 1024).toFixed(0)} KB · ${cur.source_kind}` : ''}</span>
          <ZoomControls fitRatio={fitRatio} />
          <span>← → 翻图 · 滚轮缩放 · 双击放大 · Esc 退出</span>
        </div>
        <div className="bw-lb-img" ref={boxRef} onClick={(e) => e.stopPropagation()}>
          {url ? (
            <>
              <ResetOnChange token={url} />
              <TransformComponent
                // 库给 wrapper 和 content 的默认值是 width/height: fit-content，
                // 两层都按内容收缩、不填满父容器。不覆盖成 100%，img 的
                // max-height 就又失去参照，等于把这次要修的 bug 原样重演一遍。
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%' }}
              >
                <img
                  src={url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoad={(e) => setNat({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })}
                />
              </TransformComponent>
            </>
          ) : (
            <p className="bw-empty">正在解码…</p>
          )}
        </div>
      </TransformWrapper>
    </div>
  );
}
```

- [ ] **Step 4: 改样式**

`src/browser/browser.css`，把第 213–214 行那两条替换成：

```css
/* 原来是 grid + place-items:center。那样 auto 行高按图片 max-content 算，
   而 img 的 max-height:100% 又要反过来参照行高——循环解析的结果是
   max-height 退化成 auto，竖长图撑爆容器、底部被裁掉。 */
.bw-lb-img { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }

.bw-lb-zoom { display: inline-flex; align-items: center; gap: 6px; }
.bw-lb-zoom button {
  width: 20px; height: 20px; display: grid; place-items: center;
  border: 1px solid rgba(255,255,255,.25); border-radius: 5px;
  background: none; color: #ddd; font-size: 13px; line-height: 1; cursor: pointer;
}
.bw-lb-zoom button:hover { background: rgba(255,255,255,.14); color: #fff; }
.bw-lb-zoom b {
  min-width: 42px; text-align: center; font-weight: 500;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: 跑测试**

Run: `npm test`
Expected: **FAIL**，`tests/browser/detail-pane.test.ts` 报 `document is not defined`（原因见 Step 2）。

如果它没失败，说明打包链路跟预期不同，先停下来搞清楚再往下走。

- [ ] **Step 6: 给那个测试文件单独换环境**

在 `tests/browser/detail-pane.test.ts` 的**第一行**（所有 import 之前）加：

```ts
// @vitest-environment jsdom
// 这个文件传递性 import 到 Lightbox → react-zoom-pan-pinch，而那个库在模块
// 顶层就 document.createElement('style') 注入样式，node 环境下加载即崩。
// 只给这一个文件换环境，core 的测试继续跑在更快的 node 下。
```

不要改 `vitest.config.ts` 的全局 `environment`——`tests/core/` 那批不需要 DOM，换成 jsdom 只会让它们变慢。

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test`
Expected: PASS，全绿。

- [ ] **Step 8: 构建**

Run: `npm run build`
Expected: 构建成功。若报 CSP 或外部依赖相关错误，先停下来——MV3 的产物不允许远程脚本，但 npm 依赖打进 bundle 是正常的。

- [ ] **Step 9: 同步 `CLAUDE.md`**

「现状」段的验收期间新增项列表里追加：

```markdown
- **浏览页看图器可缩放**：默认完整显示整张图，滚轮缩放、拖拽平移、双击切换、⤢ 复位。
  缩放交给 `react-zoom-pan-pinch`
```

「实测硬事实」段追加两条（放在评论相关那组之后）：

```markdown
看图器相关：

- **`react-zoom-pan-pinch` 的 `TransformComponent` 默认 `width/height: fit-content`**，
  wrapper 和 content 两层都按内容收缩、不填满父容器。必须用 `wrapperStyle`/`contentStyle`
  覆盖成 `100%`，否则 img 的 `max-height` 失去参照，竖长图照样撑爆容器——这正是本次要修的 bug。
- **看图器的尺寸只能取 `naturalWidth`/`naturalHeight`**，不能用 `ImageRecord.width/height`。
  同一个看图器也被评论配图复用，而评论图记的是展示尺寸。
- **`TransformWrapper` 只返回 `Context.Provider`，不渲染 DOM**，夹在 flex 布局中间是安全的。
- **这个库在模块顶层 `document.createElement('style')`**，node 环境下 import 即崩。
  传递性 import 到它的测试文件要加 `// @vitest-environment jsdom`。
```

决策表追加一行：

```markdown
| 看图器的缩放交给 `react-zoom-pan-pinch` | 不要自己写手势——锚点数学不难，难的是 pointer capture、拖拽与 click 的竞争、捏合、边界收敛。也不要换 photoswipe（2024-05 后停更，且是整套 lightbox）或 @panzoom/panzoom（框架无关，React 粘合层仍要自己写） |
```

- [ ] **Step 10: 提交**

```bash
git add package.json package-lock.json src/browser/components/Lightbox.tsx src/browser/browser.css tests/browser/detail-pane.test.ts CLAUDE.md
git commit -m "fix: 浏览页大图完整显示，并支持缩放平移

原来 .bw-lb-img 用 grid + place-items:center，auto 行高按图片
max-content 算，而 img 的 max-height:100% 又要反过来参照行高——
循环解析让 max-height 退化成 auto，竖长图撑爆容器、底部被裁掉。

改成 object-fit:contain 负责完整显示、react-zoom-pan-pinch 负责
缩放。库的 TransformComponent 默认 fit-content，必须显式覆盖成
100%，否则等于换个姿势重演同一个 bug。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 11: 真实页面验收**

重新加载 `dist/` 后打开浏览页，逐条确认：

1. 选一篇有**竖长图**的笔记（1080×1920 之类），点开大图——**整张图完整可见，底部没有被裁**。这是本次要修的主问题
2. 滚轮能放大缩小，光标位置就是缩放锚点
3. 放大后能按住拖动
4. 双击在完整显示与放大之间切换
5. 顶栏 `−` `+` 能用，`⤢` 能复位，百分比数字随缩放变化且完整显示时数值合理（长图会小于 100%，小图是 100%）
6. `←` `→` 翻图后倍率回到完整显示
7. 点图片以外的黑色背景能关闭；**拖动图片后松手不会误关**
8. 展开评论，点开一张**评论配图**（声明尺寸不准的那批），确认同样完整可见、百分比正常
9. 拖动详情栏与列表之间的分隔条改变宽度，确认图跟着重新适配

---

## Self-Review

**1. Spec coverage**

| 设计文档章节 | 对应任务 |
|---|---|
| §2 顶栏重排 | Task 3（去品牌、chips 靠左）+ Task 5 Step 5（齿轮按钮） |
| §3 设置页 | Task 4 |
| §4 数据层 | Task 1 |
| §5 采集流程（三态、跳过、pageStep） | Task 2（三态）+ Task 5 Step 7（跳过） |
| §6 测试 | Task 1 Step 2（三条 settings 用例）+ Task 5 Step 12（验收） |
| §7 根因 | Task 6 Step 4（CSS 注释里记下推导） |
| §8 选库 | Task 6 Step 1 |
| §9.1 fit-content 坑 | Task 6 Step 3（`wrapperStyle`/`contentStyle`）+ Step 9（写进 CLAUDE.md） |
| §9.2 scale=1 是 fit、百分比换算 | Task 6 Step 3（`ZoomControls` 的 `fitRatio`） |
| §9.3 pointer-events 与 stopPropagation | Task 6 Step 3（`.bw-lb-img` 的 `onClick` 保留）+ Step 11.7（验收） |
| §9.4 样式运行时注入 | Task 6 Step 2/5/6（node 环境崩溃与 jsdom 修法） |
| §10 组件配置 | Task 6 Step 3 |
| §11 不做的事 | 计划里没有对应任务，符合预期 |
| §12 测试 | Task 6 Step 11（验收清单 9 条） |
| §13 文档同步 | Task 5 Step 10 + Task 6 Step 9 |

无遗漏。

**2. Placeholder scan**

无 TBD/TODO；每个代码步骤都给了可直接粘贴的完整代码；没有「参照 Task N」式的省略——Task 5 Step 7 的 share 段落即使与 author 段结构雷同也完整写出。

**3. Type consistency**

- `AuthorOutcome`/`ShareOutcome` 的 `kind` 取值 `'ok' | 'skipped' | 'fail'` 在 Task 2 定义，Task 2 Step 6 与 Task 5 Step 7 的构造点用的是同一组字面量。
- `CaptureSetup` 的 props（`captureAuthor`/`captureShare`/`onChange`/`onBack`）在 Task 4 定义，Task 5 Step 6 的调用点一致；`onChange` 的参数形状 `{ captureAuthor, captureShare }` 与 Task 5 `saveCapture` 的签名一致。
- `Settings` 的字段名 `captureAuthor`/`captureShare` 在 Task 1、4、5 中拼写一致。
- `Lightbox` 的 props 未改动，`DetailPane` 的调用点不需要跟着改——已在 Task 6 的 Interfaces 里点明。
- `IconGear` 在 Task 4 Step 3 定义，Task 5 Step 1 import。
