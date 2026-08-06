# 作者悬浮卡片信息采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 采集笔记时一并记录作者悬浮卡片里的简介、关注、粉丝、获赞与收藏，落进 `note.json` 的 `author`，并在 sidepanel 与浏览页呈现。

**Architecture:** 扩展自己不发任何请求。注入 MAIN world 的脚本用合成鼠标事件让页面**自己**去请求 `hover_card`，钩子拦下响应后把卡片收起。核心层只做归一化，不碰 DOM 与 chrome API。字段并入 `note.json` 的 `author`，不新建文件，浏览页因此零额外读盘。

**Tech Stack:** TypeScript、React、Vitest（node + jsdom）、Chrome MV3 `chrome.scripting.executeScript`

设计文档：`docs/superpowers/specs/2026-08-06-author-card-design.md`

## Global Constraints

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。每个任务都是这个结构。
- **每个任务结束提交一次**，commit message 在任务最后一步给出。
- **核心层（`src/core/`）不碰 DOM 和 chrome API**，依赖一律通过参数注入，必须能在 Node 下用 Vitest 跑。碰 `chrome.*` 或 DOM 的代码只能出现在 `src/sidepanel/`、`src/background/`、`src/page/`、`src/browser/`。
- **注入脚本（`src/page/`）的函数体会被序列化后在页面上下文运行**，不能引用模块内的任何外部变量——正则、常量、辅助函数全部写在函数体里。
- **注入脚本全程 try/catch 且始终返回值**。抛出去会让 `executeScript` 的 `result` 变成 `undefined`，现场信息全丢。
- **代码注释用中文，写「为什么」而不是「做了什么」**。
- **改了行为就同步改文档**，与代码放在同一个 commit 里。
- 运行测试：`npm test`（等价 `vitest run`）。单文件：`npx vitest run tests/path/to.test.ts`。
- 类型检查：`npx tsc --noEmit`。

## 实测事实（不要凭直觉改）

这些在真实登录页面上验证过，实现时直接照做：

- 悬浮卡片的触发元素是 `.author-container span.username`。页面底部另有 `.author-wrapper > a.author`，**那不是触发元素**。
- 合成事件必须对 `document` 到目标元素的**整条祖先链**逐层派发不冒泡的 `pointerenter` 与 `mouseenter`。只派发目标元素及其两三层父节点无效——实测卡片不弹、请求不发。
- 收起卡片时 leave 系列事件必须带 `relatedTarget`，并且要对那个元素再派发一整套 enter 链。只派发 leave 收不掉。
- `hover_card` 走的是 **XHR**（不是 fetch），但两者都钩住更保险。
- 响应体里**没有 userId**，身份只能从请求 URL 的 `target_user_id` 取。
- 页面对 `hover_card` 有客户端缓存，同一作者第二次 hover 不再发请求，所以必须有 DOM 兜底。
- 卡片 DOM 结构（实测）：

```
DIV.tooltip-content
  DIV.basic-info  > DIV.avatar-click-wrapper > A.avatar-info > DIV.name   ← 昵称
  DIV.desc                                                                ← 简介
  DIV.interaction-info > A.interaction ×3 > SPAN.interaction-name         ← 关注/粉丝/获赞与收藏
```

`A.interaction` 的 `innerText` 形如 `"21\n关注"`；数字元素的 class 不稳定，用「整体文本去掉 `.interaction-name` 文本」来取数值。

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/types.ts`（改） | `RawAuthorCard`、`AuthorBase`、`AuthorCardFields`、`ArchivedAuthor` |
| `src/core/extractor.ts`（改） | `parseCount` 增加对「千」的支持 |
| `src/core/author.ts`（新） | 卡片响应 → `AuthorCardFields` 的归一化，纯函数 |
| `src/core/serialize.ts`（改） | `note.json` 的 `author` 段落盘，新字段可缺省 |
| `src/page/read-author.ts`（新） | 注入 MAIN world：弹卡片 → 接数据 → 收卡片 |
| `src/sidepanel/App.tsx`（改） | 采集流程里调一次读取，合并进 `note.author` |
| `src/sidepanel/components/NoteView.tsx`（改） | 读取中的状态行、结果里的作者行 |
| `src/core/browse/types.ts`（改） | `RowMeta` 增加 `authorFans` / `authorInteraction` |
| `src/core/browse/row-meta.ts`（改） | 从 `note.json` 读出这两个字段 |
| `src/core/browse/scope.ts`（改） | `SortKey` 增加两键，`null` 沉底 |
| `src/browser/components/Table.tsx`（改） | 两列 + 排序表头 |
| `src/browser/components/DetailPane.tsx`（改） | 作者块 + 原文链接 + 主页链接 |
| `src/browser/browser.css`（改） | 新列宽、作者块、链接样式 |

---

### Task 1: 类型与归一化

**Files:**
- Modify: `src/types.ts`
- Modify: `src/core/extractor.ts:5-18`（`parseCount`）
- Create: `src/core/author.ts`
- Test: `tests/core/author.test.ts`（新建）、`tests/core/extractor.test.ts`（增补）

**Interfaces:**
- Consumes: `parseCount` from `src/core/extractor.ts`
- Produces:
  - `RawAuthorCard`、`AuthorBase`、`AuthorCardFields`、`ArchivedAuthor`（`src/types.ts`）
  - `extractAuthorCard(raw: RawAuthorCard, fetchedAt: string): AuthorCardFields | null`（`src/core/author.ts`）

- [ ] **Step 1: 在 `src/types.ts` 顶部加入新类型**

加在文件开头（`RawImage` 之前）：

```ts
/**
 * hover_card 接口的响应体里的 data。
 * 注意：它**没有 userId**，身份只能从请求 URL 的 target_user_id 取。
 * DOM 兜底路径读不到认证类型，那时 verify_info 整个缺席。
 */
export interface RawAuthorCard {
  basic_info?: { nickname?: string; images?: string; desc?: string };
  verify_info?: { red_official_verify_type?: number };
  interact_info?: { follows?: string; fans?: string; interaction?: string };
  [k: string]: unknown;
}

/** 任何地方都有的作者身份四件套。评论作者只有这些。 */
export interface AuthorBase {
  user_id: string;
  nickname: string;
  avatar_url: string;
  profile_url: string;
}

/**
 * 悬浮卡片带来的字段。没采到时这一整组都不写——card_fetched_at 在不在
 * 就是「有没有采到作者信息」的判据，绝不用 fans: 0 这种假值占位。
 */
export interface AuthorCardFields {
  desc: string;
  /** DOM 兜底路径读不到认证类型，此时字段缺席。写 0 会让「未认证」与「不知道」无法区分。 */
  verify_type?: number;
  follows: number;
  fans: number;
  interaction: number;
  /** 原始字符串。大号返回「10万+」时 parseCount 给出的不是真值，得留一份原文。 */
  counts_raw: { follows: string; fans: string; interaction: string };
  /** counts_raw 里出现 + 万 千 亿 时为真，提醒读数据的人别拿去算。 */
  approximate: boolean;
  card_fetched_at: string;
}

/** note.json 里的 author：身份四件套 + 可选的卡片字段。 */
export type ArchivedAuthor = AuthorBase & Partial<AuthorCardFields>;
```

- [ ] **Step 2: 把现有的 author 类型换成新类型**

`src/types.ts` 中三处改动：

1. `ExtractedComment.author` 由 `ExtractedNote['author']` 改为 `AuthorBase`
2. `ExtractedNote.author` 由内联对象字面量改为 `ArchivedAuthor`
3. `CommentRecord.author` 由 `ExtractedNote['author']` 改为 `AuthorBase`

`NoteRecord.author` 保持写法 `ExtractedNote['author']` 不动——它会自动跟着变成 `ArchivedAuthor`。

评论作者**不能**用 `ArchivedAuthor`：评论里永远没有卡片字段，给它一个可选卡片字段的类型会误导后来的人以为可以填。

- [ ] **Step 3: 为 `parseCount` 的「千」写失败的测试**

在 `tests/core/extractor.test.ts` 的 `parseCount` describe 块里追加：

```ts
  // 作者卡片的计数与互动数同样是字符串，且实测出现过「1千+」这种量级。
  it('识别千', () => {
    expect(parseCount('1千')).toBe(1000);
    expect(parseCount('1千+')).toBe(1000);
    expect(parseCount('1.5千')).toBe(1500);
  });
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npx vitest run tests/core/extractor.test.ts`
Expected: FAIL，`parseCount('1千')` 得到 `1` 而不是 `1000`（走了末尾的 lead 分支）

- [ ] **Step 5: 让 `parseCount` 支持「千」**

`src/core/extractor.ts` 中把单位分支改为：

```ts
  const m = s.match(/^([\d.]+)\s*(千|万|亿)\+?$/);
  if (m) {
    const unit = m[2] === '千' ? 1_000 : m[2] === '万' ? 10_000 : 100_000_000;
    return Math.round(Number.parseFloat(m[1]!) * unit);
  }
```

同时把函数顶部的注释改成：`/** 互动数与作者计数在页面里都是字符串，可能带「千」「万」「亿」「+」。 */`

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/core/extractor.test.ts`
Expected: PASS（含原有全部用例）

- [ ] **Step 7: 写 `extractAuthorCard` 的失败测试**

创建 `tests/core/author.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { extractAuthorCard } from '../../src/core/author';
import type { RawAuthorCard } from '../../src/types';

const FETCHED = '2026-08-06T14:32:10+08:00';

const full: RawAuthorCard = {
  basic_info: { nickname: '不会coding的开发', images: 'https://sns-avatar-qc.xhscdn.com/avatar/x', desc: '简介第一行\n第二行' },
  verify_info: { red_official_verify_type: 0 },
  interact_info: { follows: '21', fans: '384', interaction: '1500' },
};

describe('extractAuthorCard', () => {
  it('归一化完整卡片', () => {
    expect(extractAuthorCard(full, FETCHED)).toEqual({
      desc: '简介第一行\n第二行',
      verify_type: 0,
      follows: 21,
      fans: 384,
      interaction: 1500,
      counts_raw: { follows: '21', fans: '384', interaction: '1500' },
      approximate: false,
      card_fetched_at: FETCHED,
    });
  });

  // 大号的计数是「10万+」这种，parseCount 给出的不是真值，必须标出来。
  it('计数带量级后缀时标记 approximate', () => {
    const r = extractAuthorCard({ ...full, interact_info: { follows: '21', fans: '10万+', interaction: '1千+' } }, FETCHED)!;
    expect(r.approximate).toBe(true);
    expect(r.fans).toBe(100000);
    expect(r.interaction).toBe(1000);
    expect(r.counts_raw).toEqual({ follows: '21', fans: '10万+', interaction: '1千+' });
  });

  // DOM 兜底路径读不到认证类型。写 0 会让「未认证」与「不知道」变得无法区分。
  it('没有 verify_info 时整个字段缺席，而不是写 0', () => {
    const r = extractAuthorCard({ ...full, verify_info: undefined }, FETCHED)!;
    expect('verify_type' in r).toBe(false);
  });

  it('简介缺失时给空串', () => {
    const r = extractAuthorCard({ ...full, basic_info: { nickname: 'x' } }, FETCHED)!;
    expect(r.desc).toBe('');
  });

  // 三个计数一个都没有，说明这份卡片没意义，当作没采到而不是写半份数据。
  it('计数全缺时返回 null', () => {
    expect(extractAuthorCard({ ...full, interact_info: {} }, FETCHED)).toBeNull();
    expect(extractAuthorCard({ ...full, interact_info: undefined }, FETCHED)).toBeNull();
  });

  // 计数为「0」是合法的真值，不能当成缺失。
  it('计数为 0 时照常归一化', () => {
    const r = extractAuthorCard({ ...full, interact_info: { follows: '0', fans: '0', interaction: '0' } }, FETCHED)!;
    expect(r).toMatchObject({ follows: 0, fans: 0, interaction: 0, approximate: false });
  });

  it('部分计数缺失时缺的那个记 0，原文记空串', () => {
    const r = extractAuthorCard({ ...full, interact_info: { fans: '384' } }, FETCHED)!;
    expect(r).toMatchObject({ follows: 0, fans: 384, interaction: 0 });
    expect(r.counts_raw).toEqual({ follows: '', fans: '384', interaction: '' });
  });
});
```

- [ ] **Step 8: 跑测试确认失败**

Run: `npx vitest run tests/core/author.test.ts`
Expected: FAIL，`Cannot find module '../../src/core/author'`

- [ ] **Step 9: 写 `src/core/author.ts`**

```ts
import type { AuthorCardFields, RawAuthorCard } from '../types';
import { parseCount } from './extractor';

/**
 * 计数被平台模糊化的判据。实测大号会返回「10万+」，降级时还出现过「1千+」，
 * 这些经 parseCount 得到的都不是真值，落盘时必须标出来。
 */
function isApproximate(...values: string[]): boolean {
  return values.some((v) => /[+千万亿]/.test(v));
}

/**
 * 卡片响应 → 落盘字段。返回 null 表示这份卡片没有意义，调用方当作没采到。
 *
 * verify_type 只在响应里真的带了 verify_info 时才写：DOM 兜底路径读不到认证
 * 类型，写 0 会让「未认证」与「不知道」变得无法区分。
 */
export function extractAuthorCard(raw: RawAuthorCard, fetchedAt: string): AuthorCardFields | null {
  const ii = raw.interact_info;
  // 三个计数一个都没有的卡片没有采集价值，不写半份数据。
  if (!ii || (ii.follows === undefined && ii.fans === undefined && ii.interaction === undefined)) {
    return null;
  }

  const follows = ii.follows ?? '';
  const fans = ii.fans ?? '';
  const interaction = ii.interaction ?? '';

  const out: AuthorCardFields = {
    desc: raw.basic_info?.desc ?? '',
    follows: parseCount(follows),
    fans: parseCount(fans),
    interaction: parseCount(interaction),
    counts_raw: { follows, fans, interaction },
    approximate: isApproximate(follows, fans, interaction),
    card_fetched_at: fetchedAt,
  };

  const verify = raw.verify_info?.red_official_verify_type;
  if (typeof verify === 'number') out.verify_type = verify;

  return out;
}
```

- [ ] **Step 10: 跑全量测试与类型检查**

Run: `npx vitest run tests/core/author.test.ts tests/core/extractor.test.ts && npx tsc --noEmit`
Expected: 测试全 PASS；`tsc` 无错误

- [ ] **Step 11: 提交**

```bash
git add src/types.ts src/core/extractor.ts src/core/author.ts tests/core/author.test.ts tests/core/extractor.test.ts
git commit -m "feat: 作者卡片字段的类型与归一化"
```

---

### Task 2: 落盘 `note.json` 的 author 段

**Files:**
- Modify: `src/core/serialize.ts:33-38`（`serializeNote` 的 `author` 段）
- Test: `tests/core/serialize.test.ts`（增补）

**Interfaces:**
- Consumes: `ArchivedAuthor`、`AuthorCardFields`（Task 1）
- Produces: `serializeNote` 在 `author` 有卡片字段时按固定顺序写出，没有时一个都不写

- [ ] **Step 1: 写失败的测试**

在 `tests/core/serialize.test.ts` 里追加。文件顶部若还没有 `NoteRecord` 的构造工具，直接照下面写完整对象：

```ts
  // 卡片字段按固定顺序排在身份四件套之后，与 note.json 其余部分一样不靠对象字面量顺序
  it('author 有卡片字段时按固定顺序写出', () => {
    const rec = makeNote();
    rec.author = {
      user_id: 'u1',
      nickname: '小红',
      avatar_url: 'https://a/x',
      profile_url: 'https://www.xiaohongshu.com/user/profile/u1',
      desc: '简介',
      verify_type: 0,
      follows: 21,
      fans: 384,
      interaction: 1500,
      counts_raw: { follows: '21', fans: '384', interaction: '1500' },
      approximate: false,
      card_fetched_at: '2026-08-06T14:32:10+08:00',
    };
    const j = JSON.parse(serializeNote(rec)) as { author: Record<string, unknown> };
    expect(Object.keys(j.author)).toEqual([
      'user_id', 'nickname', 'avatar_url', 'profile_url',
      'desc', 'verify_type', 'follows', 'fans', 'interaction',
      'counts_raw', 'approximate', 'card_fetched_at',
    ]);
    expect(j.author.counts_raw).toEqual({ follows: '21', fans: '384', interaction: '1500' });
  });

  // card_fetched_at 在不在，就是「有没有采到作者信息」的判据
  it('没采到作者卡片时一个新字段都不写', () => {
    const rec = makeNote();
    rec.author = {
      user_id: 'u1', nickname: '小红', avatar_url: '', profile_url: 'https://p/u1',
    };
    const j = JSON.parse(serializeNote(rec)) as { author: Record<string, unknown> };
    expect(Object.keys(j.author)).toEqual(['user_id', 'nickname', 'avatar_url', 'profile_url']);
  });

  // DOM 兜底路径读不到认证类型，那一个字段单独缺席，其余照写
  it('只有 verify_type 缺席时其余卡片字段照写', () => {
    const rec = makeNote();
    rec.author = {
      user_id: 'u1', nickname: '小红', avatar_url: '', profile_url: 'https://p/u1',
      desc: '', follows: 0, fans: 82, interaction: 6046,
      counts_raw: { follows: '0', fans: '82', interaction: '6046' },
      approximate: false, card_fetched_at: '2026-08-06T14:32:10+08:00',
    };
    const j = JSON.parse(serializeNote(rec)) as { author: Record<string, unknown> };
    expect(Object.keys(j.author)).not.toContain('verify_type');
    expect(j.author.fans).toBe(82);
  });
```

若 `tests/core/serialize.test.ts` 里没有 `makeNote()`，在文件顶部加：

```ts
function makeNote(): NoteRecord {
  return {
    schema_version: 1,
    note_id: 'n1',
    url: 'https://www.xiaohongshu.com/explore/n1',
    type: 'normal',
    title: '标题',
    content: '正文',
    tags: [],
    published_at: '2026-08-01T10:00:00+08:00',
    last_edited_at: '2026-08-01T10:00:00+08:00',
    author: { user_id: 'u1', nickname: '小红', avatar_url: '', profile_url: 'https://p/u1' },
    interact: { liked: 1, collected: 2, comment: 3, share: 4 },
    images: [],
    archive: {
      first_archived_at: '2026-08-06T10:00:00+08:00',
      last_archived_at: '2026-08-06T10:00:00+08:00',
      collector: 'zach',
      archive_count: 1,
      status: 'complete',
    },
    raw: { noteId: 'n1', type: 'normal', time: 0, user: { userId: 'u1', nickname: '小红', avatar: '' }, interactInfo: {}, imageList: [] },
  };
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/serialize.test.ts`
Expected: FAIL，`author` 的 key 只有身份四件套，缺 `desc` 等

- [ ] **Step 3: 改 `serializeNote` 的 author 段**

`src/core/serialize.ts` 里把 `author: { ... }` 那一段替换为对 `authorOf(n.author)` 的调用，并在 `serializeNote` 之前加这个函数：

```ts
/**
 * 卡片字段整组可缺席：card_fetched_at 在不在就是「有没有采到作者信息」的判据，
 * 缺的时候一个都不写，绝不用 fans: 0 占位。verify_type 还能单独缺席——
 * DOM 兜底路径读不到认证类型，写 0 会让「未认证」与「不知道」无法区分。
 */
function authorOf(a: ArchivedAuthor): Record<string, unknown> {
  const out: Record<string, unknown> = {
    user_id: a.user_id,
    nickname: a.nickname,
    avatar_url: a.avatar_url,
    profile_url: a.profile_url,
  };
  if (a.card_fetched_at === undefined) return out;

  out.desc = a.desc ?? '';
  if (a.verify_type !== undefined) out.verify_type = a.verify_type;
  out.follows = a.follows ?? 0;
  out.fans = a.fans ?? 0;
  out.interaction = a.interaction ?? 0;
  out.counts_raw = {
    follows: a.counts_raw?.follows ?? '',
    fans: a.counts_raw?.fans ?? '',
    interaction: a.counts_raw?.interaction ?? '',
  };
  out.approximate = a.approximate ?? false;
  out.card_fetched_at = a.card_fetched_at;
  return out;
}
```

`serializeNote` 里改为 `author: authorOf(n.author),`，并在文件顶部的 import 里加上 `ArchivedAuthor`。

`comment()` 里的 `author` 段**不要动**——评论作者只有身份四件套。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/serialize.test.ts && npx tsc --noEmit`
Expected: PASS，无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/core/serialize.ts tests/core/serialize.test.ts
git commit -m "feat: note.json 的 author 段支持卡片字段"
```

---

### Task 3: 注入脚本 `read-author.ts`

**Files:**
- Create: `src/page/read-author.ts`
- Test: `tests/page/read-author.test.ts`（新建，jsdom 环境）

**Interfaces:**
- Consumes: `RawAuthorCard`（Task 1）
- Produces:
  - `readAuthorCardFromPage(expectedUserId: string): Promise<AuthorReadResult>`
  - `readAuthorViaTab(tabId: number, expectedUserId: string): Promise<AuthorReadResult>`
  - `AuthorReadResult`、`AuthorDiag`、`AuthorReadFailure`

- [ ] **Step 1: 写失败的测试**

创建 `tests/page/read-author.test.ts`。首行必须是环境 docblock：

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readAuthorCardFromPage } from '../../src/page/read-author';

/** 搭出实测的作者栏 DOM。 */
function mountAuthor(): void {
  document.body.innerHTML = `
    <div class="note-container">
      <div class="author-container"><a class="name"><span class="username">小红</span></a></div>
    </div>`;
}

/** 搭出实测的卡片 DOM。 */
function mountCard(nickname: string, desc: string, counts: [string, string, string]): void {
  const card = document.createElement('div');
  card.className = 'tooltip-content';
  card.innerHTML = `
    <div class="basic-info"><div class="avatar-click-wrapper"><a class="avatar-info"><div class="name">${nickname}</div></a></div></div>
    <div class="desc">${desc}</div>
    <div class="interaction-info">
      <a class="interaction">${counts[0]}<span class="interaction-name">关注</span></a>
      <a class="interaction">${counts[1]}<span class="interaction-name">粉丝</span></a>
      <a class="interaction">${counts[2]}<span class="interaction-name">获赞与收藏</span></a>
    </div>`;
  document.body.appendChild(card);
}

/**
 * 装一个假的 XHR：一旦目标元素收到 mouseenter，就在下一个 tick 回一份 hover_card 响应。
 * 真实页面就是这么工作的——脚本不发请求，只是让页面自己去发。
 */
function fakeXhrOnHover(uid: string, body: unknown): void {
  class FakeXHR {
    private handlers: Record<string, (() => void)[]> = {};
    responseText = '';
    __u = '';
    open(_m: string, u: string) { this.__u = u; }
    send() {
      this.responseText = JSON.stringify(body);
      setTimeout(() => { for (const h of this.handlers.load ?? []) h(); }, 0);
    }
    addEventListener(t: string, h: () => void) { (this.handlers[t] ??= []).push(h); }
  }
  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR;

  const un = document.querySelector('.author-container span.username')!;
  un.addEventListener('mouseenter', () => {
    const x = new (globalThis as unknown as { XMLHttpRequest: new () => { open(m: string, u: string): void; send(): void } }).XMLHttpRequest();
    x.open('GET', `https://edith.xiaohongshu.com/api/sns/web/v1/user/hover_card?target_user_id=${uid}&xsec_source=pc_note`);
    x.send();
  });
}

const CARD_BODY = {
  code: 0,
  success: true,
  data: {
    basic_info: { nickname: '小红', images: 'https://a/x', desc: '简介' },
    verify_info: { red_official_verify_type: 0 },
    interact_info: { follows: '21', fans: '384', interaction: '1500' },
  },
};

describe('readAuthorCardFromPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('找不到作者元素时报 no_element', async () => {
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_element');
    expect(r.diag.elementFound).toBe(false);
  });

  it('对整条祖先链派发 enter，而不只是目标元素', async () => {
    mountAuthor();
    const seen: string[] = [];
    for (const el of [document.body, document.querySelector('.note-container')!, document.querySelector('.author-container')!]) {
      el.addEventListener('mouseenter', () => seen.push((el as HTMLElement).className || 'body'));
    }
    await readAuthorCardFromPage('u1');
    expect(seen).toContain('author-container');
    expect(seen).toContain('note-container');
    expect(seen).toContain('body');
  });

  it('抓到页面自己发的响应', async () => {
    mountAuthor();
    fakeXhrOnHover('u1', CARD_BODY);
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw.interact_info).toEqual({ follows: '21', fans: '384', interaction: '1500' });
    expect(r.diag.via).toBe('hook');
    expect(r.diag.uid).toBe('u1');
  });

  // 页面中途切了笔记，卡片属于上一个作者。写进去会张冠李戴。
  it('uid 与预期不符时整个丢弃', async () => {
    mountAuthor();
    fakeXhrOnHover('other', CARD_BODY);
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('uid_mismatch');
  });

  // 页面对 hover_card 有客户端缓存，使用者自己先看过一眼，钩子就什么都抓不到。
  it('没有网络响应但卡片已弹出时从 DOM 兜底', async () => {
    mountAuthor();
    const un = document.querySelector('.author-container span.username')!;
    un.addEventListener('mouseenter', () => mountCard('小红', '简介', ['21', '384', '1500']));
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.raw.interact_info).toEqual({ follows: '21', fans: '384', interaction: '1500' });
      expect(r.raw.basic_info?.desc).toBe('简介');
      // DOM 上读不到认证类型，这个字段必须缺席
      expect(r.raw.verify_info).toBeUndefined();
    }
    expect(r.diag.via).toBe('dom');
  });

  it('既没响应也没卡片时报 timeout', async () => {
    mountAuthor();
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  // 卡片留在页面上会挡住使用者正在看的内容。
  it('无论成败都派发带 relatedTarget 的 leave 收起卡片', async () => {
    mountAuthor();
    const un = document.querySelector('.author-container span.username')!;
    let leaveRelated: EventTarget | null | undefined;
    un.addEventListener('mouseleave', (e) => { leaveRelated = (e as MouseEvent).relatedTarget; });
    await readAuthorCardFromPage('u1');
    expect(leaveRelated).toBe(document.body);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/page/read-author.test.ts`
Expected: FAIL，`Cannot find module '../../src/page/read-author'`

- [ ] **Step 3: 写 `src/page/read-author.ts`**

```ts
import type { RawAuthorCard } from '../types';

/** 每次读取都回传的现场快照，用于排查。 */
export interface AuthorDiag {
  /** 有没有找到 .author-container span.username */
  elementFound: boolean;
  /** hook = 抓到页面自己发的响应；dom = 走文本兜底；null = 都没有 */
  via: 'hook' | 'dom' | null;
  /** 实际等了多少毫秒 */
  waitedMs: number;
  /** 从请求 URL 取到的 target_user_id */
  uid: string | null;
  error?: string;
}

export type AuthorReadFailure =
  /** 页面上找不到作者元素——多半是小红书改版，选择器失效 */
  | 'no_element'
  /** 既没抓到响应，卡片也没弹出来 */
  | 'timeout'
  /** 拿到的卡片不属于当前笔记作者（页面中途切了笔记） */
  | 'uid_mismatch'
  /** 页面内抛异常 */
  | 'page_error'
  /** 注入本身没跑成 */
  | 'inject_failed';

export type AuthorReadResult =
  | { ok: true; raw: RawAuthorCard; diag: AuthorDiag }
  | { ok: false; reason: AuthorReadFailure; detail?: string; diag: AuthorDiag };

/**
 * 注入到页面 MAIN world 执行：让页面自己去请求作者卡片，把响应接住，再把卡片收起。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**，
 * 常量、正则、辅助函数都得写在函数体里。
 *
 * 四条实测约束：
 * 1. 触发元素是 .author-container span.username。页面底部另有 .author-wrapper >
 *    a.author，那不是它，对着它派发事件毫无反应。
 * 2. 必须对 document 到目标元素的**整条祖先链**逐层派发不冒泡的 pointerenter /
 *    mouseenter。只派发目标元素及其两三层父节点，卡片不弹、请求也不发。
 * 3. 收起卡片时 leave 系列必须带 relatedTarget，并对那个元素再派发一整套 enter，
 *    否则组件认为指针还停在原处，卡片一直挂在使用者眼前。
 * 4. 页面对 hover_card 有客户端缓存，同一作者第二次 hover 不再发请求。所以钩子
 *    等不到时要从 DOM 兜底，否则「自己先看过一眼的作者反而采不到」。
 */
export async function readAuthorCardFromPage(expectedUserId: string): Promise<AuthorReadResult> {
  const diag: AuthorDiag = { elementFound: false, via: null, waitedMs: 0, uid: null };

  try {
    const TIMEOUT_MS = 3000;
    const POLL_MS = 100;

    const target = document.querySelector('.author-container span.username');
    diag.elementFound = target !== null;
    if (!target) return { ok: false, reason: 'no_element', diag };

    // jsdom 里 PointerEvent 支持不完整，真实页面上偶尔也会缺；降级到 MouseEvent
    // 不影响触发，enter 链才是关键。
    const PE: typeof MouseEvent =
      typeof PointerEvent !== 'undefined' ? (PointerEvent as unknown as typeof MouseEvent) : MouseEvent;

    let captured: { uid: string | null; data: RawAuthorCard } | null = null;

    const grab = (url: string, text: string) => {
      if (url.indexOf('hover_card') < 0) return;
      try {
        const body = JSON.parse(text) as { data?: RawAuthorCard };
        if (!body || !body.data) return;
        const m = /target_user_id=([0-9a-zA-Z]+)/.exec(url);
        captured = { uid: m ? m[1]! : null, data: body.data };
      } catch (e) { /* 不是我们要的响应，忽略 */ }
    };

    // 钩住 XHR 与 fetch。实测 hover_card 走 XHR，但两个都钩更保险。
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR(this: unknown) {
      const x = new OrigXHR();
      const open = x.open as (...a: unknown[]) => void;
      let seen = '';
      x.open = function (method: string, url: string, ...rest: unknown[]) {
        seen = url;
        open.call(x, method, url, ...rest);
      } as typeof x.open;
      x.addEventListener('load', () => { grab(seen, x.responseText); });
      return x;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
        const p = origFetch.apply(this, args);
        try {
          const first = args[0];
          const url = typeof first === 'string' ? first : (first as Request | URL).toString();
          if (url.indexOf('hover_card') >= 0) {
            void p.then((r) => r.clone().text()).then((t) => { grab(url, t); }).catch(() => {});
          }
        } catch (e) { /* 取 url 失败不该拖累原请求 */ }
        return p;
      } as typeof fetch;
    }

    const chainOf = (el: Element | null): (Element | Document)[] => {
      const out: (Element | Document)[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) out.unshift(n);
      out.unshift(document);
      return out;
    };

    const enter = (el: Element, related: Element | null) => {
      const r = el.getBoundingClientRect();
      const o: MouseEventInit = {
        view: window,
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        bubbles: true,
        cancelable: true,
        relatedTarget: related,
      };
      el.dispatchEvent(new PE('pointerover', o));
      for (const n of chainOf(el)) n.dispatchEvent(new PE('pointerenter', { ...o, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseover', o));
      for (const n of chainOf(el)) n.dispatchEvent(new MouseEvent('mouseenter', { ...o, bubbles: false }));
      el.dispatchEvent(new PE('pointermove', o));
      el.dispatchEvent(new MouseEvent('mousemove', o));
    };

    const leave = (el: Element, to: Element) => {
      const o: MouseEventInit = {
        view: window, clientX: 0, clientY: 0, bubbles: true, cancelable: true, relatedTarget: to,
      };
      el.dispatchEvent(new PE('pointerout', o));
      for (const n of chainOf(el).reverse()) n.dispatchEvent(new PE('pointerleave', { ...o, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseout', o));
      for (const n of chainOf(el).reverse()) n.dispatchEvent(new MouseEvent('mouseleave', { ...o, bubbles: false }));
      // 再让「指针」进入别处，否则组件认为它还停在作者名上，卡片收不回去。
      enter(to, el);
    };

    /** 卡片已渲染时从文本兜底。读不到认证类型，那个字段就该缺席。 */
    const fromDom = (): RawAuthorCard | null => {
      const card = document.querySelector('.tooltip-content');
      if (!card) return null;
      const counts: Record<string, string> = {};
      for (const a of Array.from(card.querySelectorAll('.interaction-info a.interaction'))) {
        const nameEl = a.querySelector('.interaction-name');
        const label = (nameEl?.textContent ?? '').trim();
        const value = ((a as HTMLElement).textContent ?? '').replace(label, '').trim();
        if (label === '关注') counts.follows = value;
        else if (label === '粉丝') counts.fans = value;
        else if (label === '获赞与收藏') counts.interaction = value;
      }
      if (counts.follows === undefined && counts.fans === undefined && counts.interaction === undefined) {
        return null;
      }
      return {
        basic_info: {
          nickname: (card.querySelector('.basic-info .name')?.textContent ?? '').trim(),
          desc: (card.querySelector('.desc')?.textContent ?? '').trim(),
        },
        interact_info: { follows: counts.follows, fans: counts.fans, interaction: counts.interaction },
      };
    };

    const started = Date.now();
    enter(target, null);

    let domCard: RawAuthorCard | null = null;
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (captured) break;
      domCard = fromDom();
      if (domCard) break;
    }
    diag.waitedMs = Date.now() - started;

    // 无论成败都要收起来：卡片留在页面上会挡住使用者正在看的内容。
    try {
      leave(target, document.body);
    } catch (e) { /* 收不起来也不该把已经拿到的数据丢掉 */ }

    window.XMLHttpRequest = OrigXHR;
    if (typeof origFetch === 'function') window.fetch = origFetch;

    if (captured) {
      const hit = captured as { uid: string | null; data: RawAuthorCard };
      diag.via = 'hook';
      diag.uid = hit.uid;
      // 页面中途切了笔记时，抓到的会是上一个作者。写进去就是张冠李戴。
      if (hit.uid !== null && hit.uid !== expectedUserId) {
        return { ok: false, reason: 'uid_mismatch', detail: `卡片属于 ${hit.uid}`, diag };
      }
      return { ok: true, raw: hit.data, diag };
    }

    if (domCard) {
      diag.via = 'dom';
      // DOM 上没有 userId，无从校验身份。卡片是我们刚让它为当前作者弹出来的，
      // 且这条路径只在同一次调用内成立，风险可接受。
      return { ok: true, raw: domCard, diag };
    }

    return { ok: false, reason: 'timeout', diag };
  } catch (e) {
    diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason: 'page_error', detail: diag.error, diag };
  }
}

const EMPTY_DIAG: AuthorDiag = { elementFound: false, via: null, waitedMs: 0, uid: null };

/**
 * 注入失败与「页面上没有作者元素」必须分开报：前者是扩展侧问题（权限、world、
 * 时序），后者是页面侧问题（改版、还没渲染）。
 */
export async function readAuthorViaTab(tabId: number, expectedUserId: string): Promise<AuthorReadResult> {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readAuthorCardFromPage,
      args: [expectedUserId],
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'inject_failed',
      detail: e instanceof Error ? e.message : String(e),
      diag: { ...EMPTY_DIAG },
    };
  }

  const result = res?.result as AuthorReadResult | undefined;
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

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/page/read-author.test.ts`
Expected: 全部 PASS。

三个用例（祖先链、timeout、leave）会走满 3 秒超时，整个文件跑十秒左右属正常，不要因为「慢」就去调小 `TIMEOUT_MS`——那个值是留给真实网络的。若「整条祖先链」那条失败，检查 `chainOf` 是否包含了 `document` 与全部 `parentElement`。

- [ ] **Step 5: 跑全量测试与类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全 PASS，无类型错误

- [ ] **Step 6: 提交**

```bash
git add src/page/read-author.ts tests/page/read-author.test.ts
git commit -m "feat: 注入脚本读取作者悬浮卡片"
```

---

### Task 4: 采集流程接入与 sidepanel 呈现

**Files:**
- Modify: `src/sidepanel/components/NoteView.tsx:12-21`（`ArchiveOutcome`）、`:100-128`（`Result`）、`:130-141`（props）、`:268-290`（动作区）
- Modify: `src/sidepanel/App.tsx`（`doArchive`）
- Test: `tests/sidepanel/note-view.test.ts`（新建）

**Interfaces:**
- Consumes: `readAuthorViaTab`（Task 3）、`extractAuthorCard`（Task 1）
- Produces: `ArchiveOutcome.author: AuthorOutcome`，其中
  `type AuthorOutcome = { ok: true; fans: number; interaction: number; approximate: boolean } | { ok: false; reason: AuthorReadFailure }`

- [ ] **Step 1: 写失败的测试**

创建 `tests/sidepanel/note-view.test.ts`：

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Result, type ArchiveOutcome } from '../../src/sidepanel/components/NoteView';
import type { ExtractedComments } from '../../src/types';

const comments: ExtractedComments = {
  declaredTotal: 10, collectedCount: 10, complete: true, hasMore: false, list: [],
};

function outcome(author: ArchiveOutcome['author']): ArchiveOutcome {
  return {
    mode: 'new', status: 'complete', path: 'collected/n1', failures: [],
    imageCount: 3, comments, commentImageFailures: [], author,
  };
}

describe('Result 里的作者信息', () => {
  it('采到时显示粉丝与获赞收藏', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: true, fans: 384, interaction: 1500, approximate: false }) }),
    );
    expect(html).toContain('384');
    expect(html).toContain('1,500');
    expect(html).not.toContain('约');
  });

  // 大号的计数是平台模糊过的，不能让人以为那是精确值
  it('approximate 时标注「约」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: true, fans: 100000, interaction: 1000, approximate: true }) }),
    );
    expect(html).toContain('约');
  });

  // 采不到不阻断归档，但必须如实说，别让人以为采到了
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: false, reason: 'no_element' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('作者信息未采到');
    expect(html).toContain('重采这篇可以再试');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: FAIL，`Result` 没有导出（当前是模块内私有函数）

- [ ] **Step 3: 改 `NoteView.tsx`**

1. 顶部 import 加：`import type { AuthorReadFailure } from '../../page/read-author';`

2. 在 `ArchiveOutcome` 之前加类型，并给 `ArchiveOutcome` 加字段：

```ts
/** 作者卡片这一步的结果。采不到不阻断归档，但要如实说。 */
export type AuthorOutcome =
  | { ok: true; fans: number; interaction: number; approximate: boolean }
  | { ok: false; reason: AuthorReadFailure };
```

`ArchiveOutcome` 内追加：`author: AuthorOutcome;`

3. 加失败原因的中文说明表（放在 `UNREADABLE` 之后）：

```ts
const AUTHOR_FAIL: Record<AuthorReadFailure, string> = {
  no_element: '页面上没找到作者元素',
  timeout: '等卡片超时',
  uid_mismatch: '卡片不属于这篇的作者',
  page_error: '页面脚本出错',
  inject_failed: '注入页面脚本失败',
};
```

4. 把 `function Result(...)` 改为 `export function Result(...)`，并在 `complete` 分支的 `<dl>` 里、评论那一项之后追加：

```tsx
        <dt>作者</dt>
        <dd>
          {outcome.author.ok ? (
            <>
              {outcome.author.approximate && '约 '}
              {outcome.author.fans.toLocaleString('zh-CN')} 粉丝 ·{' '}
              {outcome.author.approximate && '约 '}
              {outcome.author.interaction.toLocaleString('zh-CN')} 获赞与收藏
            </>
          ) : (
            <>作者信息未采到：{AUTHOR_FAIL[outcome.author.reason]}。重采这篇可以再试。</>
          )}
        </dd>
```

5. `NoteView` 的 props 增加 `authorReading: boolean;`，在动作区 `progress ? (...)` 那一段之前插入读取中的提示。把动作区改成：

```tsx
        {authorReading ? (
          <>
            <div className="sect-h">正在读取作者信息…</div>
            <p className="hint">页面上会闪一下作者卡片，随后自动收起。</p>
            <button className="btn" disabled>采集中…</button>
          </>
        ) : progress ? (
```

原有的 `progress ? (...) : (...)` 结构保持不变，只是多包了一层。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/sidepanel/note-view.test.ts`
Expected: PASS

- [ ] **Step 5: 改 `App.tsx` 的采集流程**

1. import 加：

```ts
import { readAuthorViaTab } from '../page/read-author';
import { extractAuthorCard } from '../core/author';
import { nowBeijingIso } from '../core/time';
import type { AuthorOutcome } from './components/NoteView';
```

2. 组件内加状态：`const [authorReading, setAuthorReading] = useState(false);`

3. 在 `doArchive` 里，**紧跟在 `isValidDatasetPath` 校验之后、`setProgress` 之前**插入读取。位置很关键：`ensurePermission` 依赖用户手势且有效期只有几秒，作者读取必须排在它后面。

```ts
    // 作者卡片：让页面自己去请求，我们只接住结果。约 1.5–3 秒，期间卡片会在
    // 页面上闪现后自动收起。采不到不阻断归档——附属数据不该把主干拖下水。
    setAuthorReading(true);
    // 初值就是失败态：读作者的任何一条岔路都不该让后面的 archive 拿到未赋值的变量。
    let author: AuthorOutcome = { ok: false, reason: 'inject_failed' };
    const noteToWrite = { ...plan.note };
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        const read = await readAuthorViaTab(tab.id, plan.note.author.user_id);
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
    } finally {
      setAuthorReading(false);
    }
```

`author` 带初值声明在 `try` 外，`finally` 里只关状态，这样后面的 `archive` 调用在任何一条路径上都能读到它。

4. `archive({ ... })` 的 `note` 参数由 `plan.note` 改为 `noteToWrite`。

5. 末尾 `setJustArchived({ ... })` 里追加 `author,`。

6. `NoteView` 的 JSX 加上 `authorReading={authorReading}`。

- [ ] **Step 6: 类型检查与全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: 无类型错误，测试全 PASS

- [ ] **Step 7: 提交**

```bash
git add src/sidepanel/App.tsx src/sidepanel/components/NoteView.tsx tests/sidepanel/note-view.test.ts
git commit -m "feat: 采集时读取作者卡片并在侧边栏呈现状态与结果"
```

---

### Task 5: 浏览页 RowMeta 与排序

**Files:**
- Modify: `src/core/browse/types.ts:28-48`（`RowMeta`）
- Modify: `src/core/browse/row-meta.ts:36-55`（`meta` 构造）
- Modify: `src/core/browse/scope.ts:30-46`（`SortKey`、`compareByMeta`）
- Test: `tests/core/browse/row-meta.test.ts`（增补）、`tests/core/browse/scope.test.ts`（增补，若无则新建）

**Interfaces:**
- Consumes: `note.json` 里 Task 2 写出的 `author` 段
- Produces: `RowMeta.authorFans: number | null`、`RowMeta.authorInteraction: number | null`；`SortKey` 增加 `'authorFans' | 'authorInteraction'`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/row-meta.test.ts` 在 `describe('loadNote', ...)` 块内追加。该文件已有 `noteJson(over)` 工具，直接覆盖它的 `author` 字段即可：

```ts
  it('读出作者卡片字段', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({
      author: {
        user_id: 'u1', nickname: '小 A', avatar_url: 'https://x/a.jpg', profile_url: 'https://x/u1',
        desc: '简介', verify_type: 0, follows: 21, fans: 384, interaction: 1500,
        counts_raw: { follows: '21', fans: '384', interaction: '1500' },
        approximate: false, card_fetched_at: '2026-08-06T14:32:10+08:00',
      },
    }));
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.authorFans).toBe(384);
    expect(r.ok && r.meta.authorInteraction).toBe(1500);
  });

  // 老数据没有这些字段。null 不等于 0——「不知道」和「是 0」必须区分开
  it('老 note.json 没有卡片字段时给 null', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.authorFans).toBeNull();
    expect(r.ok && r.meta.authorInteraction).toBeNull();
  });
```

`tests/core/browse/scope.test.ts` 先给该文件已有的 `meta()` 工具补两个默认值（否则类型不完整）：

```ts
    lastArchivedAt: '', archiveCount: 1, publishedAt: '', lastEditedAt: '',
    authorFans: null, authorInteraction: null,
    ...over,
```

然后在 `describe('compareByMeta', ...)` 块内追加：

```ts
  it('按粉丝数排序', () => {
    expect(compareByMeta('authorFans', meta({ authorFans: 100 }), meta({ authorFans: 200 }))).toBeLessThan(0);
  });

  // 没采到作者信息的行沉到末尾。把 null 当 0 会让它们混在真实的零粉丝账号里
  it('authorFans 为 null 的沉到末尾', () => {
    const withValue = meta({ noteId: A, authorFans: 0 });
    const withNull = meta({ noteId: B, authorFans: null });
    expect(compareByMeta('authorFans', withNull, withValue)).toBeGreaterThan(0);
    expect(compareByMeta('authorFans', withValue, withNull)).toBeLessThan(0);
  });

  // 两个都没采到时仍要有确定的序，否则每次重排位置乱跳
  it('两个都是 null 时回落到 noteId', () => {
    expect(compareByMeta('authorFans', meta({ noteId: A, authorFans: null }), meta({ noteId: B, authorFans: null })))
      .toBeLessThan(0);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/browse/`
Expected: FAIL，`authorFans` 不存在于 `RowMeta`

- [ ] **Step 3: 给 `RowMeta` 加字段**

`src/core/browse/types.ts` 的 `RowMeta` 里，在 `authorNickname` 之后加：

```ts
  /** 采集时刻的作者粉丝数。null 表示这篇没采到作者信息（老数据或当时读取失败）。 */
  authorFans: number | null;
  /** 采集时刻的作者获赞与收藏数。null 的含义同上。 */
  authorInteraction: number | null;
```

- [ ] **Step 4: 在 `loadNote` 里读出来**

`src/core/browse/row-meta.ts` 的 `meta` 对象里，`authorNickname` 之后加：

```ts
      authorFans: typeof j.author?.fans === 'number' ? j.author.fans : null,
      authorInteraction: typeof j.author?.interaction === 'number' ? j.author.interaction : null,
```

- [ ] **Step 5: 加排序键并让 null 沉底**

`src/core/browse/scope.ts`：

`SortKey` 增加两个键：

```ts
export type SortKey =
  | 'title' | 'authorNickname' | 'authorFans' | 'authorInteraction'
  | 'liked' | 'collected' | 'comment' | 'share'
  | 'imageCount' | 'archiveCount'
  | 'publishedAt' | 'lastEditedAt' | 'firstArchivedAt' | 'lastArchivedAt'
  | 'collector';
```

`compareByMeta` 顶部加 null 处理：

```ts
export function compareByMeta(key: SortKey, a: RowMeta, b: RowMeta): number {
  const x = a[key];
  const y = b[key];
  // 没采到作者信息的沉到末尾，升序降序都一样。把 null 当 0 会让它们混进
  // 真实的零粉丝账号里，「不知道」和「是 0」必须区分开。
  if (x === null || y === null) {
    if (x === null && y === null) return a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0;
    return x === null ? 1 : -1;
  }
  let r = 0;
  ...
```

注意：`sortRefs` 在降序时会对结果取反，所以「沉底」在降序下会浮到顶部。这是可接受的——`sortRefs` 已有的「缺元数据沉到末尾」也是同样的行为，保持一致比特殊处理更好懂。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/core/browse/ && npx tsc --noEmit`
Expected: PASS。`tsc` 可能报 `useRows.ts` 等处缺字段——本任务只改 core 层，若报错说明有别处手工构造过 `RowMeta`，一并补上两个字段即可。

- [ ] **Step 7: 提交**

```bash
git add src/core/browse/types.ts src/core/browse/row-meta.ts src/core/browse/scope.ts tests/core/browse/
git commit -m "feat: 浏览页元数据带上作者粉丝与获赞收藏"
```

---

### Task 6: 浏览页表格两列

**Files:**
- Modify: `src/browser/components/Table.tsx:66-90`（表头）、`:118-134`（行）
- Modify: `src/browser/browser.css:86-91`（列宽）

**Interfaces:**
- Consumes: `RowMeta.authorFans` / `authorInteraction`、`SortKey`（Task 5）
- Produces: 无（纯展示）

- [ ] **Step 1: 加一个把 null 显示成破折号的工具**

`src/browser/components/Table.tsx` 里 `num` 函数之后加：

```ts
/** 没采到作者信息时显示破折号。写 0 会让人以为这个号真的零粉丝。 */
function numOrDash(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('zh-CN');
}
```

- [ ] **Step 2: 表头加两列**

在 `{th('authorNickname', '作者', 'c-author')}` 之后插入：

```tsx
        {th('authorFans', '粉丝', 'c-fans')}
        {th('authorInteraction', '获赞藏', 'c-fans')}
```

- [ ] **Step 3: 行里加两列**

在 `<span className="c-author" title={m.authorNickname}>{m.authorNickname}</span>` 之后插入：

```tsx
                <span className="c-fans">{numOrDash(m.authorFans)}</span>
                <span className="c-fans">{numOrDash(m.authorInteraction)}</span>
```

- [ ] **Step 4: 加列宽样式**

`src/browser/browser.css` 中 `.c-num` 那一行之后加：

```css
/* 粉丝与获赞收藏可能到七位数，比 .c-num 宽一档 */
.c-fans { flex: none; width: 62px; text-align: right; }
```

- [ ] **Step 5: 构建确认无误**

Run: `npx tsc --noEmit && npm run build`
Expected: 均成功

- [ ] **Step 6: 提交**

```bash
git add src/browser/components/Table.tsx src/browser/browser.css
git commit -m "feat: 浏览页表格增加粉丝与获赞收藏两列"
```

---

### Task 7: 详情栏作者块与原文链接

**Files:**
- Modify: `src/browser/components/DetailPane.tsx:169-183`
- Modify: `src/browser/browser.css`（追加）
- Test: `tests/browser/detail-pane.test.ts`（增补）

**Interfaces:**
- Consumes: `NoteDetail.author`（已随 Task 1 的 `ArchivedAuthor` 自动带上卡片字段）、`NoteDetail.url`
- Produces: 导出 `AuthorBlock` 供测试

- [ ] **Step 1: 写失败的测试**

`tests/browser/detail-pane.test.ts` 追加：

```ts
import { AuthorBlock } from '../../src/browser/components/DetailPane';
import type { ArchivedAuthor } from '../../src/types';

const base: ArchivedAuthor = {
  user_id: 'u1', nickname: '小红', avatar_url: '',
  profile_url: 'https://www.xiaohongshu.com/user/profile/u1',
};

describe('AuthorBlock', () => {
  it('有卡片字段时显示简介与三个计数', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: {
        ...base, desc: '学术废物', follows: 6, fans: 82, interaction: 6046,
        counts_raw: { follows: '6', fans: '82', interaction: '6046' },
        approximate: false, card_fetched_at: '2026-08-06T14:32:10+08:00',
      },
      noteUrl: 'https://www.xiaohongshu.com/explore/n1',
    }));
    expect(html).toContain('学术废物');
    expect(html).toContain('82');
    expect(html).toContain('6,046');
  });

  // 老数据没有卡片字段，不能显示 0
  it('没有卡片字段时只显示昵称，不显示 0', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base, noteUrl: 'https://www.xiaohongshu.com/explore/n1',
    }));
    expect(html).toContain('小红');
    expect(html).not.toContain('粉丝');
  });

  it('原文与主页都是新标签页打开的链接', () => {
    const html = renderToStaticMarkup(createElement(AuthorBlock, {
      author: base, noteUrl: 'https://www.xiaohongshu.com/explore/n1',
    }));
    expect(html).toContain('href="https://www.xiaohongshu.com/explore/n1"');
    expect(html).toContain('href="https://www.xiaohongshu.com/user/profile/u1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/browser/detail-pane.test.ts`
Expected: FAIL，`AuthorBlock` 未导出

- [ ] **Step 3: 写 `AuthorBlock`**

`src/browser/components/DetailPane.tsx` 中 `DetailPane` 之前加：

```tsx
function cardTime(iso: string): string {
  return iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : iso;
}

/**
 * 作者信息块。卡片字段整组可能缺席（老数据，或采集时没读到），
 * 那时只显示昵称——显示 0 粉丝会被当成事实。
 */
export function AuthorBlock({ author, noteUrl }: { author: ArchivedAuthor; noteUrl: string }) {
  const hasCard = author.card_fetched_at !== undefined;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString('zh-CN');
  const approx = author.approximate === true ? '约 ' : '';

  return (
    <section className="bw-author">
      <p className="bw-author-line">
        <span className="bw-author-name">{author.nickname}</span>
        <a href={author.profile_url} target="_blank" rel="noreferrer" className="bw-link">作者主页 ↗</a>
        <a href={noteUrl} target="_blank" rel="noreferrer" className="bw-link">小红书原文 ↗</a>
      </p>
      {hasCard && author.desc && <p className="bw-author-desc">{author.desc}</p>}
      {hasCard && (
        <p className="bw-dim">
          {approx}{n(author.follows)} 关注 · {approx}{n(author.fans)} 粉丝 · {approx}{n(author.interaction)} 获赞与收藏
        </p>
      )}
      {hasCard && (
        <p className="bw-dim">作者信息采于 {cardTime(author.card_fetched_at!)}</p>
      )}
    </section>
  );
}
```

顶部 import 加 `ArchivedAuthor`：`import type { ArchivedAuthor, CommentRecord } from '../../types';`

- [ ] **Step 4: 在 `DetailPane` 里替换原来那行作者**

把 `<p>👤 {detail.author.nickname}</p>` 换成：

```tsx
        <AuthorBlock author={detail.author} noteUrl={detail.url} />
```

- [ ] **Step 5: 加样式**

`src/browser/browser.css` 末尾追加：

```css
.bw-author { margin: 10px 0; }
.bw-author-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.bw-author-name { color: var(--ink); font-weight: 600; }
.bw-author-desc { white-space: pre-wrap; color: var(--ink-2); margin: 4px 0; }
.bw-link { color: var(--accent); text-decoration: none; font-size: 12px; }
.bw-link:hover { text-decoration: underline; }
```

若 `--ink-2` 在 `src/styles/tokens.css` 里不存在，改用已有的 `--ink-3`。

- [ ] **Step 6: 跑测试与构建**

Run: `npx vitest run tests/browser/detail-pane.test.ts && npx tsc --noEmit && npm run build`
Expected: 均成功

- [ ] **Step 7: 提交**

```bash
git add src/browser/components/DetailPane.tsx src/browser/browser.css tests/browser/detail-pane.test.ts
git commit -m "feat: 浏览页详情栏展示作者信息与原文链接"
```

---

### Task 8: 文档同步

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-03-xhs-archiver-design.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 前 7 个任务的最终行为
- Produces: 无代码产物

- [ ] **Step 1: 在 `CLAUDE.md` 的「实测硬事实」里追加作者卡片一节**

放在评论那一组之后：

```markdown
作者悬浮卡片（同样是登录页实测）：

- **卡片数据来自 `GET /api/sns/web/v1/user/hover_card`**，需要签名，裸 fetch 是 406。`xsec_token` 就是 `raw.user.xsecToken`。
- **合成事件可以让页面自己去请求**，但必须对 `document` 到目标元素的**整条祖先链**逐层派发不冒泡的 `pointerenter`/`mouseenter`。只派发目标元素及其两三层父节点，卡片不弹、请求也不发——这条踩过，别再试一遍。
- **触发元素是 `.author-container span.username`**。页面底部的 `.author-wrapper > a.author` 不是它。
- **收卡片时 leave 系列必须带 `relatedTarget`**，并对那个元素再派发一整套 enter。只派发 leave 收不掉，卡片会一直挂在使用者眼前。
- **响应体里没有 userId**，身份只能从请求 URL 的 `target_user_id` 取，必须与 `note.user.userId` 比对。
- **页面对 hover_card 有客户端缓存**，同一作者第二次 hover 不再发请求。所以必须有 DOM 兜底（`.tooltip-content` 下的 `.basic-info .name`、`.desc`、`.interaction-info a.interaction`），否则「自己先看过一眼的作者反而采不到」。
- **不要走作者主页 SSR**。`user/profile/{id}` 的 HTML 里有同样的数据且不需要签名，但有会话级频控降级：一分钟内请求几次，数字就从 `384` 变成 `10+`，且**真实导航过去看到的也是 `10+`**，等于污染使用者自己的浏览体验。
- **计数可能是「10万+」「1千+」**，`parseCount` 给出的不是真值，所以要留 `counts_raw` 与 `approximate`。
```

- [ ] **Step 2: 在 `CLAUDE.md` 的决策表里追加**

```markdown
| 作者卡片靠合成事件让页面自己请求 | 不要裸 fetch（406）、不要加签、不要用 `chrome.debugger` |
| 作者字段并入 `note.json` 的 `author` | 不要为它单开 `author.json` |
| 没采到就一个卡片字段都不写；DOM 兜底时省略 `verify_type` | 不要写 `fans: 0`、`verify_type: 0` 占位 |
| 作者信息采不到不阻断归档 | 不要把它算进 `partial` |
```

- [ ] **Step 3: 更新 `CLAUDE.md` 的「现状」段**

在验收期间新增项的列表里追加一条：

```markdown
- **随笔记采集作者悬浮卡片信息**（简介、关注、粉丝、获赞与收藏），并进 `note.json` 的 `author`；浏览页表格增加粉丝、获赞收藏两列并可排序，详情栏展示完整作者信息与原文链接。设计见 `docs/superpowers/specs/2026-08-06-author-card-design.md`
```

- [ ] **Step 4: 在主设计文档里加指引**

`docs/superpowers/specs/2026-08-03-xhs-archiver-design.md` 的 `note.json` 结构说明处，`author` 字段旁加一句：

```markdown
`author` 在采到悬浮卡片时会多出 `desc`、`verify_type`、`follows`、`fans`、
`interaction`、`counts_raw`、`approximate`、`card_fetched_at` 八个字段，
详见 `2026-08-06-author-card-design.md`。
```

- [ ] **Step 5: 更新 `README.md` 的数据结构示例**

找到 `note.json` 的示例，`author` 段补上卡片字段，并加一句说明：没采到作者卡片时这些字段整组缺席。

- [ ] **Step 6: 提交**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-08-03-xhs-archiver-design.md
git commit -m "docs: 同步作者卡片采集的现状与实测事实"
```

---

## 真机验收（agent 做不了，需使用者操作）

全部任务完成后，`npm run build`，在 `chrome://extensions` 重新加载 `dist/`，然后：

- [ ] 独立页 `/explore/{id}` 采一篇，`note.json` 的 `author` 有 8 个新字段
- [ ] 首页 modal 采一篇
- [ ] **搜索页 modal 采一篇**——这个入口的 DOM 结构尚未验证过，是本次最可能出问题的地方
- [ ] 先手动 hover 过作者再点采集，确认走 DOM 兜底也能采到（此时 `verify_type` 缺席）
- [ ] 采集后卡片自动收起，页面上没有残留
- [ ] 采一个粉丝数很大的作者，确认 `approximate: true` 且 `counts_raw` 保留原文
- [ ] 采集途中切走笔记，确认报 `uid_mismatch` 且归档仍然完成
- [ ] 浏览页：两列显示、点列头排序、没采到的行显示 `—` 且排序时沉底
- [ ] 浏览页详情栏：作者块、原文链接与主页链接都能在新标签页打开
- [ ] 老数据（本次改动之前采的）在浏览页显示 `—` 而不是 0
