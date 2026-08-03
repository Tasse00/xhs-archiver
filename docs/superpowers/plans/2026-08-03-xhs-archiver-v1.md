# 小红书笔记归档插件 v1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 MV3 Chrome 扩展，在小红书图文笔记页点击侧边栏按钮，把正文、标签、互动数、作者与全部图片结构化归档到本地 Git 数据仓库，并支持跨采集者去重。

**Architecture:** Side Panel 是协调者兼执行者，持有 FSA 目录句柄、下载图片、写盘。数据通过 `chrome.scripting.executeScript({world:'MAIN'})` 在点击时读取页面的 `__INITIAL_STATE__`。核心层为纯 TypeScript，不接触 DOM 与 chrome API（依赖全部注入），可脱离浏览器单测；UI 层只订阅核心层状态。

**Tech Stack:** Vite 6 + @crxjs/vite-plugin 2 (beta) + TypeScript 5 + React 19 + Vitest 3

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-08-03-xhs-archiver-design.md`。本计划与其冲突时以设计文档为准。
- 采集者 ID 与数据集路径每一段强制匹配 `/^[a-z0-9_-]{1,32}$/`。原因：macOS 用 NFD 保存中文文件名，进 Git 后跨平台显示为乱码。
- 所有落盘 JSON：**固定 key 顺序、2 空格缩进、末尾一个换行符**。`raw` 字段递归按 key 排序。
- 所有时间戳格式：`YYYY-MM-DDTHH:mm:ss+08:00`，**固定 +08:00 偏移，不使用机器本地时区**，不含毫秒。
- 视频笔记判据：`note.type === "video"`。不依赖 `videoList`（实测不存在）。
- 笔记数据定位：必须用 `note.currentNoteId._value`；`noteDetailMap` 含 `""` 与 `"undefined"` 脏 key。
- `interactInfo` 各字段是字符串，需转数字。
- `file_id` 必须始终写入 `note.json`——原图凭它随时可重取，不依赖 token。
- 原图为 HEIC 时降级 `WB_DFT`（Chrome 无法解码 HEIC）。
- 指针文件路径：`_index/{noteId 前两位}/{noteId}/{采集者}.json`。
- 写盘顺序：数据完整后才写指针。**指针存在 ⟹ 数据完整。**
- 不使用 `eval` / `new Function` 执行页面提供的字符串。
- 插件不执行任何 git 命令。

## File Structure

| 文件 | 职责 |
|---|---|
| `src/types.ts` | 全部共享类型定义 |
| `src/core/time.ts` | 固定 +08:00 的时间格式化 |
| `src/core/extractor.ts` | `RawNote` → `ExtractedNote`；视频拒绝；互动数解析 |
| `src/core/image-source.ts` | `fileId` → 下载候选列表；格式判定 |
| `src/core/serialize.ts` | `NoteRecord` → 固定顺序 JSON 文本 |
| `src/core/store.ts` | FSA 封装（唯一接触 FileSystemHandle 的文件） |
| `src/core/index-store.ts` | 指针目录读写、查重、重复检测 |
| `src/core/settings.ts` | 采集者 ID、数据集路径、校验与默认值 |
| `src/core/handle-store.ts` | 目录句柄的 IndexedDB 持久化 |
| `src/core/repo-template.ts` | `.gitattributes` / `.gitignore` / `README.md` 内容与写入 |
| `src/core/downloader.ts` | 图片下载、格式校验、降级、sha256 |
| `src/core/archiver.ts` | 流程编排与状态机 |
| `src/page/read-note.ts` | 注入 MAIN world 的读取函数 |
| `src/background/service-worker.ts` | 点击图标打开侧边栏 |
| `src/sidepanel/App.tsx` | 状态机渲染入口 |
| `src/sidepanel/components/*.tsx` | 各状态的展示组件 |
| `tests/helpers/memory-fs.ts` | FSA 内存 mock，供 `store.ts` 测试 |
| `tests/fixtures/*.json` | 实测采集的真实 note 结构 |

---

### Task 1: 项目脚手架与可打开的侧边栏

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `manifest.config.ts`
- Create: `src/background/service-worker.ts`, `src/sidepanel/index.html`, `src/sidepanel/main.tsx`, `src/sidepanel/App.tsx`
- Create: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: 可 `npm run build` 出的 `dist/`，可在 `chrome://extensions` 加载并打开侧边栏

- [ ] **Step 1: 初始化依赖**

```bash
npm init -y
npm i react react-dom
npm i -D vite@^6 @crxjs/vite-plugin@^2.0.0-beta.28 @vitejs/plugin-react typescript @types/react @types/react-dom @types/chrome vitest@^3 fake-indexeddb
```

- [ ] **Step 2: 写配置文件**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["chrome", "vite/client"]
  },
  "include": ["src", "tests", "*.ts"]
}
```

`manifest.config.ts`:
```ts
import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '小红书笔记归档',
  version: '0.1.0',
  permissions: ['sidePanel', 'scripting', 'storage', 'tabs'],
  host_permissions: [
    'https://*.xiaohongshu.com/*',
    'https://*.xhscdn.com/*',
  ],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  action: { default_title: '归档这篇笔记' },
});
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

`.gitignore`:
```
node_modules/
dist/
```

在 `package.json` 的 `scripts` 中加入：
```json
{ "scripts": { "build": "vite build", "dev": "vite", "test": "vitest run" } }
```

- [ ] **Step 3: 写最小侧边栏与 service worker**

`src/background/service-worker.ts`:
```ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
```

`src/sidepanel/index.html`:
```html
<!doctype html>
<html lang="zh">
  <head><meta charset="utf-8" /><title>小红书笔记归档</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`src/sidepanel/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/sidepanel/App.tsx`:
```tsx
export function App() {
  return <main style={{ padding: 16, fontFamily: 'system-ui' }}>小红书笔记归档</main>;
}
```

- [ ] **Step 4: 构建并手工验证**

Run: `npm run build`
Expected: 生成 `dist/`，无报错。

在 Chrome 打开 `chrome://extensions` → 开启开发者模式 → 「加载已解压的扩展程序」→ 选 `dist/` → 点击扩展图标。
Expected: 侧边栏打开并显示「小红书笔记归档」。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: MV3 侧边栏脚手架"
```

---

### Task 2: 类型定义与笔记归一化

**Files:**
- Create: `src/types.ts`, `src/core/time.ts`, `src/core/extractor.ts`
- Create: `tests/core/time.test.ts`, `tests/core/extractor.test.ts`
- Create: `tests/fixtures/note-image.json`, `tests/fixtures/note-video.json`

**Interfaces:**
- Consumes: 无
- Produces:
  - `toBeijingIso(ms: number): string`
  - `parseCount(v: unknown): number`
  - `extract(raw: RawNote): ExtractResult`
  - 类型 `RawNote`, `RawImage`, `ExtractedNote`, `ExtractedImage`, `ExtractResult`, `SourceKind`, `ImageRecord`, `NoteRecord`, `Pointer`

- [ ] **Step 1: 写类型定义**

`src/types.ts`:
```ts
export interface RawImage {
  fileId: string;
  width: number;
  height: number;
  livePhoto?: boolean;
  url?: string;
  urlPre?: string;
  urlDefault?: string;
  stream?: Record<string, unknown>;
  infoList?: { imageScene: string; url: string }[];
}

export interface RawNote {
  noteId: string;
  type: string;
  title?: string;
  desc?: string;
  time: number;
  lastUpdateTime?: number;
  ipLocation?: string;
  xsecToken?: string;
  user: { userId: string; nickname: string; avatar: string; xsecToken?: string };
  interactInfo: {
    likedCount?: string;
    collectedCount?: string;
    commentCount?: string;
    shareCount?: string;
  };
  imageList: RawImage[];
  tagList?: { name: string; type: string }[];
  video?: unknown;
  [k: string]: unknown;
}

export interface ExtractedImage {
  index: number;
  fileId: string;
  declaredWidth: number;
  declaredHeight: number;
  isLive: boolean;
  urlDefault: string;
  urlPre: string;
}

export interface ExtractedNote {
  noteId: string;
  url: string;
  title: string;
  content: string;
  tags: string[];
  publishedAt: string;
  author: { user_id: string; nickname: string; avatar_url: string; profile_url: string };
  interact: { liked: number; collected: number; comment: number; share: number };
  images: ExtractedImage[];
  raw: RawNote;
}

export type ExtractRejection = 'unsupported_video' | 'missing_data';

export type ExtractResult =
  | { ok: true; note: ExtractedNote }
  | { ok: false; reason: ExtractRejection };

export type SourceKind = 'original' | 'WB_DFT' | 'WB_PRV';

export interface ImageRecord {
  index: number;
  file: string;
  is_live: boolean;
  file_id: string;
  width: number;
  height: number;
  declared_width: number;
  declared_height: number;
  bytes: number;
  sha256: string;
  source_kind: SourceKind;
  source_url: string;
}

export interface NoteRecord {
  schema_version: 1;
  note_id: string;
  url: string;
  type: 'normal';
  title: string;
  content: string;
  tags: string[];
  published_at: string;
  author: ExtractedNote['author'];
  interact: ExtractedNote['interact'];
  images: ImageRecord[];
  archive: {
    first_archived_at: string;
    last_archived_at: string;
    collector: string;
    archive_count: number;
    status: 'complete' | 'partial';
  };
  raw: RawNote;
}

export interface Pointer {
  note_id: string;
  path: string;
  collector: string;
  title: string;
  first_archived_at: string;
  last_archived_at: string;
}
```

- [ ] **Step 2: 写失败测试**

`tests/core/time.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toBeijingIso } from '../../src/core/time';

describe('toBeijingIso', () => {
  it('固定 +08:00 偏移，不含毫秒', () => {
    // 1778584454000 = 2026-05-12T04:34:14Z = 北京 12:34:14
    expect(toBeijingIso(1778584454000)).toBe('2026-05-12T12:34:14+08:00');
  });

  it('跨零点仍正确', () => {
    expect(toBeijingIso(Date.UTC(2026, 0, 1, 20, 0, 0))).toBe('2026-01-02T04:00:00+08:00');
  });
});
```

`tests/core/extractor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extract, parseCount } from '../../src/core/extractor';
import type { RawNote } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import videoNote from '../fixtures/note-video.json';

describe('parseCount', () => {
  it('纯数字字符串', () => expect(parseCount('1236')).toBe(1236));
  it('万单位', () => expect(parseCount('1.2万')).toBe(12000));
  it('带加号', () => expect(parseCount('10万+')).toBe(100000));
  it('空值归零', () => {
    expect(parseCount('')).toBe(0);
    expect(parseCount(undefined)).toBe(0);
  });
});

describe('extract', () => {
  it('拒绝视频笔记', () => {
    const r = extract(videoNote as unknown as RawNote);
    expect(r).toEqual({ ok: false, reason: 'unsupported_video' });
  });

  it('归一化图文笔记', () => {
    const r = extract(imageNote as unknown as RawNote);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.noteId).toBe('6a030b860000000036000201');
    expect(r.note.title).toBe('听劝改造第四天，学一下许光汉优衣库穿搭');
    expect(r.note.tags).toEqual(['真听劝改造', '听劝改造自己', '找出自我穿搭风格', '穿搭改造', '优衣库']);
    expect(r.note.interact).toEqual({ liked: 1236, collected: 220, comment: 3272, share: 2383 });
    expect(r.note.author.profile_url).toBe('https://www.xiaohongshu.com/user/profile/5b1f8e0c11be103d0f4d2b7a');
    expect(r.note.url).toBe('https://www.xiaohongshu.com/explore/6a030b860000000036000201');
    expect(r.note.images).toHaveLength(1);
    expect(r.note.images[0]!.fileId).toBe('notes_pre_post/1040g3k83202lbd8f48005qcgi63ocap3qtle3do');
    expect(r.note.images[0]!.isLive).toBe(false);
  });

  it('url 中不含 xsec_token', () => {
    const r = extract(imageNote as unknown as RawNote);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.url).not.toContain('xsec_token');
  });

  it('缺少 imageList 时拒绝', () => {
    const r = extract({ ...(imageNote as unknown as RawNote), imageList: [] });
    expect(r).toEqual({ ok: false, reason: 'missing_data' });
  });
});
```

`tests/fixtures/note-image.json`（字段与实测结构一致）:
```json
{
  "noteId": "6a030b860000000036000201",
  "type": "normal",
  "title": "听劝改造第四天，学一下许光汉优衣库穿搭",
  "desc": "夏天男生这样穿真的很清爽",
  "time": 1778584454000,
  "lastUpdateTime": 1778584454000,
  "ipLocation": "广东",
  "xsecToken": "ABh2GRDZh1yjAppoQSdDibx1z_wrzdWQFdsIb8JfpUJlU=",
  "user": {
    "userId": "5b1f8e0c11be103d0f4d2b7a",
    "nickname": "不正",
    "avatar": "https://sns-avatar-qc.xhscdn.com/avatar/abc.jpg",
    "xsecToken": "AB-user-token"
  },
  "interactInfo": {
    "likedCount": "1236",
    "collectedCount": "220",
    "commentCount": "3272",
    "shareCount": "2383"
  },
  "imageList": [
    {
      "fileId": "notes_pre_post/1040g3k83202lbd8f48005qcgi63ocap3qtle3do",
      "width": 3106,
      "height": 4096,
      "livePhoto": false,
      "url": "",
      "urlPre": "http://sns-webpic-qc.xhscdn.com/pre.webp",
      "urlDefault": "http://sns-webpic-qc.xhscdn.com/dft.webp",
      "stream": {},
      "infoList": [
        { "imageScene": "WB_PRV", "url": "http://sns-webpic-qc.xhscdn.com/pre.webp" },
        { "imageScene": "WB_DFT", "url": "http://sns-webpic-qc.xhscdn.com/dft.webp" }
      ]
    }
  ],
  "tagList": [
    { "name": "真听劝改造", "type": "topic" },
    { "name": "听劝改造自己", "type": "topic" },
    { "name": "找出自我穿搭风格", "type": "topic" },
    { "name": "穿搭改造", "type": "topic" },
    { "name": "优衣库", "type": "topic" }
  ],
  "atUserList": []
}
```

`tests/fixtures/note-video.json`:
```json
{
  "noteId": "6a1111110000000011111111",
  "type": "video",
  "title": "一条视频笔记",
  "desc": "",
  "time": 1778584454000,
  "user": { "userId": "u1", "nickname": "某人", "avatar": "https://x/y.jpg" },
  "interactInfo": { "likedCount": "10", "collectedCount": "1", "commentCount": "2", "shareCount": "0" },
  "imageList": [
    { "fileId": "notes_pre_post/cover", "width": 1080, "height": 1440, "livePhoto": false, "stream": {}, "infoList": [] }
  ],
  "tagList": [],
  "video": { "media": {}, "capa": {} }
}
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/core/time.test.ts tests/core/extractor.test.ts`
Expected: FAIL — 模块 `src/core/time` 与 `src/core/extractor` 不存在。

- [ ] **Step 4: 实现**

`src/core/time.ts`:
```ts
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 固定 +08:00 偏移，不随机器时区变化，不含毫秒。 */
export function toBeijingIso(ms: number): string {
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

export function nowBeijingIso(): string {
  return toBeijingIso(Date.now());
}

/** 采集日期，用于默认数据集路径。 */
export function todayBeijing(): string {
  return nowBeijingIso().slice(0, 10);
}
```

`src/core/extractor.ts`:
```ts
import type { ExtractResult, RawNote, ExtractedImage } from '../types';
import { toBeijingIso } from './time';

/** 互动数在页面里是字符串，可能带「万」「亿」「+」。 */
export function parseCount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  if (s === '') return 0;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  const m = s.match(/^([\d.]+)\s*(万|亿)\+?$/);
  if (m) {
    const unit = m[2] === '万' ? 10_000 : 100_000_000;
    return Math.round(Number.parseFloat(m[1]!) * unit);
  }
  const lead = s.match(/^([\d.]+)/);
  return lead ? Math.round(Number.parseFloat(lead[1]!)) : 0;
}

export function extract(raw: RawNote): ExtractResult {
  if (raw.type === 'video') return { ok: false, reason: 'unsupported_video' };
  if (!raw.noteId || !Array.isArray(raw.imageList) || raw.imageList.length === 0) {
    return { ok: false, reason: 'missing_data' };
  }

  const images: ExtractedImage[] = raw.imageList.map((img, i) => ({
    index: i + 1,
    fileId: img.fileId,
    declaredWidth: img.width,
    declaredHeight: img.height,
    isLive: img.livePhoto === true,
    urlDefault: img.urlDefault ?? '',
    urlPre: img.urlPre ?? '',
  }));

  return {
    ok: true,
    note: {
      noteId: raw.noteId,
      // 刻意不含 xsec_token：它会过期，落盘只会让 diff 变脏。
      url: `https://www.xiaohongshu.com/explore/${raw.noteId}`,
      title: raw.title ?? '',
      content: raw.desc ?? '',
      tags: (raw.tagList ?? []).map((t) => t.name),
      publishedAt: toBeijingIso(raw.time),
      author: {
        user_id: raw.user.userId,
        nickname: raw.user.nickname,
        avatar_url: raw.user.avatar,
        profile_url: `https://www.xiaohongshu.com/user/profile/${raw.user.userId}`,
      },
      interact: {
        liked: parseCount(raw.interactInfo?.likedCount),
        collected: parseCount(raw.interactInfo?.collectedCount),
        comment: parseCount(raw.interactInfo?.commentCount),
        share: parseCount(raw.interactInfo?.shareCount),
      },
      images,
      raw,
    },
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/core/time.test.ts tests/core/extractor.test.ts`
Expected: PASS，全部 11 个用例。

- [ ] **Step 6: 提交**

```bash
git add src/types.ts src/core/time.ts src/core/extractor.ts tests/
git commit -m "feat: 笔记归一化与时间格式化"
```

---

### Task 3: 图片下载候选与格式判定

**Files:**
- Create: `src/core/image-source.ts`
- Create: `tests/core/image-source.test.ts`

**Interfaces:**
- Consumes: `ExtractedImage`, `SourceKind`（Task 2）
- Produces:
  - `candidatesFor(img: ExtractedImage): Candidate[]`，`interface Candidate { kind: SourceKind; url: string }`
  - `extensionFor(contentType: string): string | null`
  - `isDecodable(contentType: string): boolean`

- [ ] **Step 1: 写失败测试**

`tests/core/image-source.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { candidatesFor, extensionFor, isDecodable } from '../../src/core/image-source';
import type { ExtractedImage } from '../../src/types';

const img: ExtractedImage = {
  index: 1,
  fileId: 'notes_pre_post/abc123',
  declaredWidth: 3106,
  declaredHeight: 4096,
  isLive: false,
  urlDefault: 'http://sns-webpic-qc.xhscdn.com/dft.webp',
  urlPre: 'http://sns-webpic-qc.xhscdn.com/pre.webp',
};

describe('candidatesFor', () => {
  it('原图两个 host 优先，然后 WB_DFT，最后 WB_PRV', () => {
    expect(candidatesFor(img)).toEqual([
      { kind: 'original', url: 'https://sns-img-qc.xhscdn.com/notes_pre_post/abc123' },
      { kind: 'original', url: 'https://ci.xiaohongshu.com/notes_pre_post/abc123' },
      { kind: 'WB_DFT', url: 'http://sns-webpic-qc.xhscdn.com/dft.webp' },
      { kind: 'WB_PRV', url: 'http://sns-webpic-qc.xhscdn.com/pre.webp' },
    ]);
  });

  it('缺 fileId 时跳过原图候选', () => {
    expect(candidatesFor({ ...img, fileId: '' })).toEqual([
      { kind: 'WB_DFT', url: 'http://sns-webpic-qc.xhscdn.com/dft.webp' },
      { kind: 'WB_PRV', url: 'http://sns-webpic-qc.xhscdn.com/pre.webp' },
    ]);
  });

  it('空的降级 URL 不进入候选', () => {
    expect(candidatesFor({ ...img, urlDefault: '', urlPre: '' })).toHaveLength(2);
  });
});

describe('extensionFor', () => {
  it('识别常见类型', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/webp; charset=binary')).toBe('webp');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/heic')).toBe('heic');
  });
  it('非图片返回 null', () => {
    expect(extensionFor('text/html')).toBeNull();
  });
});

describe('isDecodable', () => {
  it('HEIC 不可解码', () => expect(isDecodable('image/heic')).toBe(false));
  it('JPEG/WebP/PNG 可解码', () => {
    expect(isDecodable('image/jpeg')).toBe(true);
    expect(isDecodable('image/webp')).toBe(true);
    expect(isDecodable('image/png')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/image-source.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/image-source.ts`:
```ts
import type { ExtractedImage, SourceKind } from '../types';

export interface Candidate {
  kind: SourceKind;
  url: string;
}

/** 实测两者返回字节数完全一致，互为镜像。 */
const ORIGINAL_HOSTS = ['https://sns-img-qc.xhscdn.com/', 'https://ci.xiaohongshu.com/'];

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/** Chrome 的 createImageBitmap 无法解码这些类型，故不能用尺寸校验。 */
const UNDECODABLE = new Set(['heic', 'heif', 'avif']);

function mimeOf(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

export function extensionFor(contentType: string): string | null {
  return EXT_BY_TYPE[mimeOf(contentType)] ?? null;
}

export function isDecodable(contentType: string): boolean {
  const ext = extensionFor(contentType);
  return ext !== null && !UNDECODABLE.has(ext);
}

/** 按优先级排列的下载候选。原图不需要任何 token。 */
export function candidatesFor(img: ExtractedImage): Candidate[] {
  const out: Candidate[] = [];
  if (img.fileId) {
    for (const host of ORIGINAL_HOSTS) out.push({ kind: 'original', url: host + img.fileId });
  }
  if (img.urlDefault) out.push({ kind: 'WB_DFT', url: img.urlDefault });
  if (img.urlPre) out.push({ kind: 'WB_PRV', url: img.urlPre });
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/image-source.test.ts`
Expected: PASS，全部 8 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/image-source.ts tests/core/image-source.test.ts
git commit -m "feat: 图片下载候选与格式判定"
```

---

### Task 4: note.json 稳定序列化

**Files:**
- Create: `src/core/serialize.ts`
- Create: `tests/core/serialize.test.ts`

**Interfaces:**
- Consumes: `NoteRecord`, `Pointer`（Task 2）
- Produces:
  - `serializeNote(n: NoteRecord): string`
  - `serializePointer(p: Pointer): string`
  - `sortKeysDeep<T>(v: T): T`

- [ ] **Step 1: 写失败测试**

`tests/core/serialize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { serializeNote, serializePointer, sortKeysDeep } from '../../src/core/serialize';
import type { NoteRecord, Pointer } from '../../src/types';

const base: NoteRecord = {
  schema_version: 1,
  note_id: 'abc',
  url: 'https://www.xiaohongshu.com/explore/abc',
  type: 'normal',
  title: 't',
  content: 'c',
  tags: ['x'],
  published_at: '2026-05-12T12:34:14+08:00',
  author: { user_id: 'u', nickname: 'n', avatar_url: 'a', profile_url: 'p' },
  interact: { liked: 1, collected: 2, comment: 3, share: 4 },
  images: [{
    index: 1, file: 'images/01.jpg', is_live: false, file_id: 'f',
    width: 10, height: 20, declared_width: 10, declared_height: 20,
    bytes: 100, sha256: 'deadbeef', source_kind: 'original', source_url: 'https://x/f',
  }],
  archive: {
    first_archived_at: '2026-08-03T14:02:11+08:00',
    last_archived_at: '2026-08-03T14:02:11+08:00',
    collector: 'zach', archive_count: 1, status: 'complete',
  },
  raw: { zulu: 1, alpha: 2 } as never,
};

describe('serializeNote', () => {
  it('key 顺序固定，2 空格缩进，末尾换行', () => {
    const out = serializeNote(base);
    expect(out.endsWith('}\n')).toBe(true);
    expect(out).toContain('\n  "note_id": "abc",');
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual([
      'schema_version', 'note_id', 'url', 'type', 'title', 'content', 'tags',
      'published_at', 'author', 'interact', 'images', 'archive', 'raw',
    ]);
  });

  it('输入 key 顺序不同不影响输出', () => {
    const shuffled = JSON.parse(JSON.stringify(base));
    const reordered: NoteRecord = { ...shuffled, raw: { alpha: 2, zulu: 1 } };
    expect(serializeNote(reordered)).toBe(serializeNote(base));
  });

  it('raw 的 key 被递归排序', () => {
    const out = JSON.parse(serializeNote(base));
    expect(Object.keys(out.raw)).toEqual(['alpha', 'zulu']);
  });

  it('相同输入两次输出完全一致', () => {
    expect(serializeNote(base)).toBe(serializeNote(base));
  });
});

describe('sortKeysDeep', () => {
  it('数组内的对象也被排序', () => {
    const r = sortKeysDeep({ list: [{ b: 1, a: 2 }] }) as { list: object[] };
    expect(Object.keys(r.list[0]!)).toEqual(['a', 'b']);
  });
  it('null 与原始值原样返回', () => {
    expect(sortKeysDeep(null)).toBeNull();
    expect(sortKeysDeep(5)).toBe(5);
  });
});

describe('serializePointer', () => {
  it('固定 key 顺序，末尾换行', () => {
    const p: Pointer = {
      note_id: 'abc', path: 'zach/2026-08-03/abc', collector: 'zach', title: 't',
      first_archived_at: '2026-08-03T14:02:11+08:00',
      last_archived_at: '2026-08-03T14:02:11+08:00',
    };
    const out = serializePointer(p);
    expect(out.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(out))).toEqual([
      'note_id', 'path', 'collector', 'title', 'first_archived_at', 'last_archived_at',
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/serialize.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/serialize.ts`:
```ts
import type { NoteRecord, Pointer } from '../types';

/**
 * 递归按 key 排序。实测 note 的字段顺序在不同入口（独立页 / 首页 modal /
 * 搜索 modal）下不一致，不排序会让每次重采的 diff 充满噪音。
 */
export function sortKeysDeep<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sortKeysDeep) as unknown as T;
  if (v !== null && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out as unknown as T;
  }
  return v;
}

function stringify(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

export function serializeNote(n: NoteRecord): string {
  return stringify({
    schema_version: n.schema_version,
    note_id: n.note_id,
    url: n.url,
    type: n.type,
    title: n.title,
    content: n.content,
    tags: n.tags,
    published_at: n.published_at,
    author: {
      user_id: n.author.user_id,
      nickname: n.author.nickname,
      avatar_url: n.author.avatar_url,
      profile_url: n.author.profile_url,
    },
    interact: {
      liked: n.interact.liked,
      collected: n.interact.collected,
      comment: n.interact.comment,
      share: n.interact.share,
    },
    images: n.images.map((i) => ({
      index: i.index,
      file: i.file,
      is_live: i.is_live,
      file_id: i.file_id,
      width: i.width,
      height: i.height,
      declared_width: i.declared_width,
      declared_height: i.declared_height,
      bytes: i.bytes,
      sha256: i.sha256,
      source_kind: i.source_kind,
      source_url: i.source_url,
    })),
    archive: {
      first_archived_at: n.archive.first_archived_at,
      last_archived_at: n.archive.last_archived_at,
      collector: n.archive.collector,
      archive_count: n.archive.archive_count,
      status: n.archive.status,
    },
    raw: sortKeysDeep(n.raw),
  });
}

export function serializePointer(p: Pointer): string {
  return stringify({
    note_id: p.note_id,
    path: p.path,
    collector: p.collector,
    title: p.title,
    first_archived_at: p.first_archived_at,
    last_archived_at: p.last_archived_at,
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/serialize.test.ts`
Expected: PASS，全部 7 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/serialize.ts tests/core/serialize.test.ts
git commit -m "feat: note.json 稳定序列化"
```

---

### Task 5: 文件系统封装

**Files:**
- Create: `src/core/store.ts`
- Create: `tests/helpers/memory-fs.ts`, `tests/core/store.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `createStore(root: FileSystemDirectoryHandle): Store`
  - `interface Store { writeFile(path, data): Promise<void>; readText(path): Promise<string | null>; exists(path): Promise<boolean>; listDir(path): Promise<string[]>; removeDir(path): Promise<void>; removeFile(path): Promise<void> }`
  - 路径一律为相对根目录的 `/` 分隔字符串，如 `zach/2026-08-03/abc/note.json`

- [ ] **Step 1: 写 FSA 内存 mock**

`tests/helpers/memory-fs.ts`:
```ts
/** FileSystemDirectoryHandle 的最小内存实现，只覆盖 store.ts 用到的 API。 */
class MemFile {
  constructor(public data: Uint8Array) {}
}

export class MemDir {
  entries = new Map<string, MemDir | MemFile>();
  kind = 'directory' as const;

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    const hit = this.entries.get(name);
    if (hit instanceof MemDir) return hit;
    if (hit) throw new DOMException('is a file', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
    const d = new MemDir();
    this.entries.set(name, d);
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const hit = this.entries.get(name);
    if (!hit && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    if (hit instanceof MemDir) throw new DOMException('is a dir', 'TypeMismatchError');
    const self = this;
    if (!hit) self.entries.set(name, new MemFile(new Uint8Array()));
    return {
      kind: 'file' as const,
      async getFile() {
        const f = self.entries.get(name) as MemFile;
        return {
          async text() { return new TextDecoder().decode(f.data); },
          size: f.data.byteLength,
        };
      },
      async createWritable() {
        const chunks: Uint8Array[] = [];
        return {
          async write(d: BlobPart) {
            if (typeof d === 'string') chunks.push(new TextEncoder().encode(d));
            else if (d instanceof Uint8Array) chunks.push(d);
            else chunks.push(new Uint8Array(await (d as Blob).arrayBuffer()));
          },
          async close() {
            const total = chunks.reduce((a, c) => a + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
            self.entries.set(name, new MemFile(merged));
          },
        };
      },
    };
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.entries.has(name)) throw new DOMException('not found', 'NotFoundError');
    this.entries.delete(name);
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of [...this.entries.keys()]) yield k;
  }
}

export function memRoot(): FileSystemDirectoryHandle {
  return new MemDir() as unknown as FileSystemDirectoryHandle;
}
```

- [ ] **Step 2: 写失败测试**

`tests/core/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('Store', () => {
  it('写入并读回嵌套路径', async () => {
    await store.writeFile('a/b/c.json', '{"x":1}\n');
    expect(await store.readText('a/b/c.json')).toBe('{"x":1}\n');
  });

  it('读不存在的文件返回 null 而非抛错', async () => {
    expect(await store.readText('nope/none.json')).toBeNull();
  });

  it('exists 正确判断', async () => {
    await store.writeFile('x/y.txt', 'hi');
    expect(await store.exists('x/y.txt')).toBe(true);
    expect(await store.exists('x/z.txt')).toBe(false);
  });

  it('listDir 列出条目，目录不存在时返回空数组', async () => {
    await store.writeFile('d/1.json', 'a');
    await store.writeFile('d/2.json', 'b');
    expect((await store.listDir('d')).sort()).toEqual(['1.json', '2.json']);
    expect(await store.listDir('missing')).toEqual([]);
  });

  it('removeDir 递归删除', async () => {
    await store.writeFile('p/q/r.json', 'x');
    await store.removeDir('p/q');
    expect(await store.exists('p/q/r.json')).toBe(false);
  });

  it('removeDir 删不存在的目录不抛错', async () => {
    await expect(store.removeDir('never/existed')).resolves.toBeUndefined();
  });

  it('removeFile 删除单个文件', async () => {
    await store.writeFile('f/g.json', 'x');
    await store.removeFile('f/g.json');
    expect(await store.exists('f/g.json')).toBe(false);
  });

  it('写入 Blob 数据', async () => {
    await store.writeFile('bin/data.bin', new Uint8Array([1, 2, 3]));
    expect(await store.exists('bin/data.bin')).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/core/store.test.ts`
Expected: FAIL — 模块 `src/core/store` 不存在。

- [ ] **Step 4: 实现**

`src/core/store.ts`:
```ts
export interface Store {
  writeFile(path: string, data: BlobPart): Promise<void>;
  readText(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<string[]>;
  removeDir(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

export function createStore(root: FileSystemDirectoryHandle): Store {
  async function dirOf(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let cur = root;
    for (const p of parts) {
      try {
        cur = await cur.getDirectoryHandle(p, { create });
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    }
    return cur;
  }

  return {
    async writeFile(path, data) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, true);
      if (!dir) throw new Error(`无法创建目录：${path}`);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    },

    async readText(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return null;
      try {
        const fh = await dir.getFileHandle(name);
        return await (await fh.getFile()).text();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async exists(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return false;
      try {
        await dir.getFileHandle(name);
        return true;
      } catch (e) {
        if (isNotFound(e)) {
          try {
            await dir.getDirectoryHandle(name);
            return true;
          } catch {
            return false;
          }
        }
        throw e;
      }
    },

    async listDir(path) {
      const dir = await dirOf(segments(path), false);
      if (!dir) return [];
      const out: string[] = [];
      for await (const k of dir.keys()) out.push(k);
      return out;
    },

    async removeDir(path) {
      const parts = segments(path);
      const name = parts.pop();
      if (!name) return;
      const dir = await dirOf(parts, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },

    async removeFile(path) {
      const parts = segments(path);
      const name = parts.pop();
      if (!name) return;
      const dir = await dirOf(parts, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/core/store.test.ts`
Expected: PASS，全部 8 个用例。

- [ ] **Step 6: 提交**

```bash
git add src/core/store.ts tests/core/store.test.ts tests/helpers/memory-fs.ts
git commit -m "feat: File System Access 封装"
```

---

### Task 6: 指针索引与查重

**Files:**
- Create: `src/core/index-store.ts`
- Create: `tests/core/index-store.test.ts`

**Interfaces:**
- Consumes: `Store`（Task 5）、`Pointer`（Task 2）、`serializePointer`（Task 4）
- Produces:
  - `bucketOf(noteId: string): string`
  - `pointerDir(noteId: string): string`
  - `pointerPath(noteId: string, collector: string): string`
  - `lookup(store: Store, noteId: string): Promise<Pointer[]>`
  - `writePointer(store: Store, p: Pointer): Promise<void>`
  - `removePointer(store: Store, noteId: string, collector: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

`tests/core/index-store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { bucketOf, pointerDir, pointerPath, lookup, writePointer, removePointer } from '../../src/core/index-store';
import type { Pointer } from '../../src/types';

const p = (collector: string, path: string): Pointer => ({
  note_id: '6a030b860000000036000201',
  path,
  collector,
  title: 't',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('路径规则', () => {
  it('bucket 取 noteId 前两位', () => expect(bucketOf('6a030b86')).toBe('6a'));
  it('指针目录', () => expect(pointerDir('6a030b86')).toBe('_index/6a/6a030b86'));
  it('指针文件', () => expect(pointerPath('6a030b86', 'zach')).toBe('_index/6a/6a030b86/zach.json'));
});

describe('lookup', () => {
  it('未采集时返回空数组', async () => {
    expect(await lookup(store, '6a030b860000000036000201')).toEqual([]);
  });

  it('写入后能查到', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
    expect(got[0]!.path).toBe('zach/2026-08-03/6a030b860000000036000201');
  });

  it('多个采集者各自一个指针，全部返回', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await writePointer(store, p('alice', 'alice/2026-08-01/6a030b860000000036000201'));
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got.map((x) => x.collector).sort()).toEqual(['alice', 'zach']);
  });

  it('跳过损坏的指针文件而不是整体失败', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await store.writeFile('_index/6a/6a030b860000000036000201/broken.json', '{ not json');
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
  });

  it('忽略非 .json 条目', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await store.writeFile('_index/6a/6a030b860000000036000201/.DS_Store', 'junk');
    expect(await lookup(store, '6a030b860000000036000201')).toHaveLength(1);
  });
});

describe('removePointer', () => {
  it('删除后查不到', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await removePointer(store, '6a030b860000000036000201', 'zach');
    expect(await lookup(store, '6a030b860000000036000201')).toEqual([]);
  });
});

describe('写入内容', () => {
  it('指针为固定顺序 JSON，末尾换行', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    const txt = await store.readText('_index/6a/6a030b860000000036000201/zach.json');
    expect(txt!.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(txt!))[0]).toBe('note_id');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/index-store.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/index-store.ts`:
```ts
import type { Pointer } from '../types';
import type { Store } from './store';
import { serializePointer } from './serialize';

const INDEX_ROOT = '_index';

/** 前两位分桶，避免单目录堆积数万条目。noteId 是 hex，分布均匀。 */
export function bucketOf(noteId: string): string {
  return noteId.slice(0, 2);
}

export function pointerDir(noteId: string): string {
  return `${INDEX_ROOT}/${bucketOf(noteId)}/${noteId}`;
}

export function pointerPath(noteId: string, collector: string): string {
  return `${pointerDir(noteId)}/${collector}.json`;
}

/**
 * 返回该笔记的全部指针。长度 > 1 说明发生了并发采集竞态
 * （多人各自未 pull 就采了同一篇），需人工清理。
 */
export async function lookup(store: Store, noteId: string): Promise<Pointer[]> {
  const names = await store.listDir(pointerDir(noteId));
  const out: Pointer[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const txt = await store.readText(`${pointerDir(noteId)}/${name}`);
    if (txt === null) continue;
    try {
      out.push(JSON.parse(txt) as Pointer);
    } catch {
      // 损坏的指针不应让整个查重失败
    }
  }
  return out;
}

export async function writePointer(store: Store, p: Pointer): Promise<void> {
  await store.writeFile(pointerPath(p.note_id, p.collector), serializePointer(p));
}

export async function removePointer(store: Store, noteId: string, collector: string): Promise<void> {
  await store.removeFile(pointerPath(noteId, collector));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/index-store.test.ts`
Expected: PASS，全部 9 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/index-store.ts tests/core/index-store.test.ts
git commit -m "feat: 分桶指针索引与查重"
```

---

### Task 7: 设置与目录句柄持久化

**Files:**
- Create: `src/core/settings.ts`, `src/core/handle-store.ts`
- Create: `tests/core/settings.test.ts`

**Interfaces:**
- Consumes: `todayBeijing`（Task 2）
- Produces:
  - `isValidSegment(s: string): boolean`
  - `isValidDatasetPath(s: string): boolean`
  - `randomCollectorId(): string`
  - `defaultDatasetPath(collector: string): string`
  - `loadSettings(area: SettingsArea): Promise<Settings>` / `saveSettings(area, s): Promise<void>`
  - `interface Settings { collector: string | null; datasetPath: string | null }`
  - `interface SettingsArea { get(keys): Promise<Record<string, unknown>>; set(items): Promise<void> }`
  - `saveRootHandle(h)` / `loadRootHandle(): Promise<FileSystemDirectoryHandle | null>`

- [ ] **Step 1: 写失败测试**

`tests/core/settings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  isValidSegment, isValidDatasetPath, randomCollectorId,
  defaultDatasetPath, loadSettings, saveSettings, type SettingsArea,
} from '../../src/core/settings';

function fakeArea(): SettingsArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys: string[]) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
  };
}

describe('isValidSegment', () => {
  it('接受小写字母数字连字符下划线', () => {
    expect(isValidSegment('zach')).toBe(true);
    expect(isValidSegment('2026-08-03')).toBe(true);
    expect(isValidSegment('a_b-1')).toBe(true);
  });
  it('拒绝中文、大写、空格、点号', () => {
    expect(isValidSegment('张三')).toBe(false);
    expect(isValidSegment('Zach')).toBe(false);
    expect(isValidSegment('a b')).toBe(false);
    expect(isValidSegment('..')).toBe(false);
    expect(isValidSegment('')).toBe(false);
  });
  it('拒绝超过 32 字符', () => {
    expect(isValidSegment('a'.repeat(33))).toBe(false);
  });
});

describe('isValidDatasetPath', () => {
  it('接受多段路径', () => expect(isValidDatasetPath('zach/2026-08-03')).toBe(true));
  it('拒绝以斜杠开头或结尾', () => {
    expect(isValidDatasetPath('/zach')).toBe(false);
    expect(isValidDatasetPath('zach/')).toBe(false);
  });
  it('拒绝含 .. 的路径', () => expect(isValidDatasetPath('zach/../etc')).toBe(false));
  it('拒绝保留的 _index 前缀', () => expect(isValidDatasetPath('_index/x')).toBe(false));
  it('拒绝空字符串', () => expect(isValidDatasetPath('')).toBe(false));
});

describe('randomCollectorId', () => {
  it('产出合法段且长度为 4', () => {
    for (let i = 0; i < 50; i++) {
      const id = randomCollectorId();
      expect(id).toHaveLength(4);
      expect(isValidSegment(id)).toBe(true);
    }
  });
});

describe('defaultDatasetPath', () => {
  it('形如 {collector}/{YYYY-MM-DD}', () => {
    const p = defaultDatasetPath('zach');
    expect(p).toMatch(/^zach\/\d{4}-\d{2}-\d{2}$/);
    expect(isValidDatasetPath(p)).toBe(true);
  });
});

describe('loadSettings / saveSettings', () => {
  it('空存储返回 null 字段', async () => {
    expect(await loadSettings(fakeArea())).toEqual({ collector: null, datasetPath: null });
  });
  it('往返一致', async () => {
    const area = fakeArea();
    await saveSettings(area, { collector: 'zach', datasetPath: 'zach/2026-08-03' });
    expect(await loadSettings(area)).toEqual({ collector: 'zach', datasetPath: 'zach/2026-08-03' });
  });
  it('拒绝保存非法采集者 ID', async () => {
    await expect(saveSettings(fakeArea(), { collector: '张三', datasetPath: null }))
      .rejects.toThrow(/采集者/);
  });
  it('拒绝保存非法数据集路径', async () => {
    await expect(saveSettings(fakeArea(), { collector: 'zach', datasetPath: '/bad' }))
      .rejects.toThrow(/数据集路径/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/settings.ts`:
```ts
import { todayBeijing } from './time';

/**
 * 目录名强制 ASCII：macOS 用 NFD 保存中文文件名，
 * 进 Git 后在其他平台会显示为乱码或被识别成不同路径。
 */
const SEGMENT_RE = /^[a-z0-9_-]{1,32}$/;
const RESERVED_TOP = '_index';

export interface Settings {
  collector: string | null;
  datasetPath: string | null;
}

export interface SettingsArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function isValidSegment(s: string): boolean {
  return SEGMENT_RE.test(s);
}

export function isValidDatasetPath(s: string): boolean {
  if (s === '' || s.startsWith('/') || s.endsWith('/')) return false;
  const parts = s.split('/');
  if (parts[0] === RESERVED_TOP) return false;
  return parts.every(isValidSegment);
}

export function randomCollectorId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]!).join('');
}

export function defaultDatasetPath(collector: string): string {
  return `${collector}/${todayBeijing()}`;
}

const KEYS = ['collector', 'datasetPath'];

export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const raw = await area.get(KEYS);
  return {
    collector: typeof raw.collector === 'string' ? raw.collector : null,
    datasetPath: typeof raw.datasetPath === 'string' ? raw.datasetPath : null,
  };
}

export async function saveSettings(area: SettingsArea, s: Settings): Promise<void> {
  if (s.collector !== null && !isValidSegment(s.collector)) {
    throw new Error('采集者 ID 只能包含小写字母、数字、连字符和下划线，且不超过 32 字符');
  }
  if (s.datasetPath !== null && !isValidDatasetPath(s.datasetPath)) {
    throw new Error('数据集路径每一段只能包含小写字母、数字、连字符和下划线，且不能以 _index 开头');
  }
  await area.set({ collector: s.collector, datasetPath: s.datasetPath });
}

/** 生产环境的存储区实现。 */
export const chromeLocalArea: SettingsArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};
```

`src/core/handle-store.ts`:
```ts
/**
 * FSA 目录句柄只能存在 IndexedDB 里（structuredClone 支持，JSON 不支持）。
 * chrome.storage 不能存句柄。
 */
const DB_NAME = 'xhs-archiver';
const STORE = 'handles';
const KEY = 'root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveRootHandle(h: FileSystemDirectoryHandle): Promise<void> {
  await tx('readwrite', (s) => s.put(h, KEY));
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h = await tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY));
  return h ?? null;
}

export async function clearRootHandle(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY));
}

/** 权限可能在浏览器重启后失效；恢复需要用户手势，故只能由 UI 点击触发。 */
export async function ensurePermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission(opts)) === 'granted';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/settings.test.ts`
Expected: PASS，全部 15 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/settings.ts src/core/handle-store.ts tests/core/settings.test.ts
git commit -m "feat: 设置校验与目录句柄持久化"
```

---

### Task 8: 数据仓库模板文件

**Files:**
- Create: `src/core/repo-template.ts`
- Create: `tests/core/repo-template.test.ts`

**Interfaces:**
- Consumes: `Store`（Task 5）
- Produces: `ensureRepoTemplates(store: Store): Promise<string[]>`（返回本次实际创建的文件名）

- [ ] **Step 1: 写失败测试**

`tests/core/repo-template.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { ensureRepoTemplates } from '../../src/core/repo-template';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('ensureRepoTemplates', () => {
  it('首次调用创建三个文件', async () => {
    const created = await ensureRepoTemplates(store);
    expect(created.sort()).toEqual(['.gitattributes', '.gitignore', 'README.md']);
  });

  it('.gitattributes 含 LFS 与 -merge 规则', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('.gitattributes'))!;
    expect(txt).toContain('**/images/** filter=lfs diff=lfs merge=lfs -text');
    expect(txt).toContain('_index/**/*.json -merge');
    expect(txt).toContain('**/note.json -merge');
  });

  it('README 含冲突处理与解除阻止的指引', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('README.md'))!;
    expect(txt).toContain('git checkout --theirs');
    expect(txt).toContain('_index/');
    expect(txt).toContain('last_archived_at');
  });

  it('已存在的文件不被覆盖', async () => {
    await store.writeFile('README.md', '我自己写的\n');
    const created = await ensureRepoTemplates(store);
    expect(created).not.toContain('README.md');
    expect(await store.readText('README.md')).toBe('我自己写的\n');
  });

  it('重复调用是幂等的', async () => {
    await ensureRepoTemplates(store);
    expect(await ensureRepoTemplates(store)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/repo-template.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/repo-template.ts`:
```ts
import type { Store } from './store';

const GITATTRIBUTES = `# 图片走 LFS
**/images/** filter=lfs diff=lfs merge=lfs -text

# 索引与笔记数据禁止逐行合并：语义上只能整份取一侧。
# 没有这一行，Git 会往 json 里插入 <<<<<<< 冲突标记，使文件变成非法 JSON。
_index/**/*.json -merge
**/note.json -merge
`;

const GITIGNORE = `.DS_Store
Thumbs.db
`;

const README = `# 小红书笔记归档数据仓库

由「小红书笔记归档」Chrome 扩展写入。本仓库只存数据，不含插件代码。

## 目录结构

\`\`\`
<root>/
├── _index/68/68a1b2c3d4e5f6/zach.json   指针：每篇每人一个文件
└── zach/2026-08-03/68a1b2c3d4e5f6/      数据：{采集者}/{数据集}/{笔记ID}
    ├── note.json
    └── images/01.jpg
\`\`\`

指针文件的存在即代表数据完整——写盘顺序保证了「先有完整数据，才有指针」。

## 合并行为

| 场景 | 结果 |
|---|---|
| 不同人采不同笔记 | 自动合并 |
| 不同人同时采同一篇 | 自动合并，但仓库中该篇存在两份，需按下文清理 |
| 同一人在两台机器上采同一篇 | \`{采集者}.json\` 冲突 |
| 同一人在两台机器上重采同一篇 | \`note.json\` 冲突 |

## 处理 json 冲突

整份取一侧，不要手工编辑合并。

\`\`\`bash
# 比较两侧采集时间
git show :2:<path>/note.json | grep last_archived_at   # ours
git show :3:<path>/note.json | grep last_archived_at   # theirs

# 取较新的一侧
git checkout --theirs <path>/note.json
git add <path>/note.json
\`\`\`

若两侧指针的 \`path\` 不同，选定后须删除另一个数据目录，否则会留下无指针指向的孤儿目录。

LFS pointer 冲突同样 \`git checkout --theirs <图片路径>\`，随后 \`git lfs pull\`。

## 清理重复采集

\`\`\`bash
find _index -mindepth 2 -maxdepth 2 -type d \\
  -exec sh -c '[ $(ls -1 "$1" | wc -l) -gt 1 ] && echo "$1"' _ {} \\;
\`\`\`

保留 \`first_archived_at\` 较早的一份，删除另一份的**数据目录与指针文件**两处。

## 解除「他人已采集」的阻止

插件在发现某篇已被他人采集时会阻止重复采集。若对方数据确实有问题，
删除对应的指针文件即可解除：

\`\`\`bash
rm _index/68/68a1b2c3d4e5f6/alice.json
\`\`\`

## 重新获取原图

\`note.json\` 中每张图都记录了 \`file_id\`。原图地址不需要任何 token：

\`\`\`
https://sns-img-qc.xhscdn.com/{file_id}
\`\`\`

\`source_kind\` 不是 \`original\` 的图片即为降级保存（多因原图为 HEIC），
可凭 \`file_id\` 批量重取。
`;

const FILES: Record<string, string> = {
  '.gitattributes': GITATTRIBUTES,
  '.gitignore': GITIGNORE,
  'README.md': README,
};

/** 只创建缺失的文件，绝不覆盖已有内容。返回本次实际创建的文件名。 */
export async function ensureRepoTemplates(store: Store): Promise<string[]> {
  const created: string[] = [];
  for (const [name, content] of Object.entries(FILES)) {
    if (await store.exists(name)) continue;
    await store.writeFile(name, content);
    created.push(name);
  }
  return created;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/repo-template.test.ts`
Expected: PASS，全部 5 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/repo-template.ts tests/core/repo-template.test.ts
git commit -m "feat: 数据仓库模板文件生成"
```

---

### Task 9: 图片下载与降级

**Files:**
- Create: `src/core/downloader.ts`
- Create: `tests/core/downloader.test.ts`

**Interfaces:**
- Consumes: `candidatesFor` / `extensionFor` / `isDecodable`（Task 3）、`ExtractedImage`（Task 2）
- Produces:
  - `interface Deps { fetch: typeof fetch; decode(b: Blob): Promise<{ width: number; height: number }>; sha256(b: ArrayBuffer): Promise<string> }`
  - `interface FetchedImage { bytes: Uint8Array; ext: string; sourceKind: SourceKind; sourceUrl: string; width: number; height: number; sha256: string }`
  - `downloadImage(img: ExtractedImage, deps: Deps): Promise<FetchedImage>`
  - `defaultDeps: Deps`

- [ ] **Step 1: 写失败测试**

`tests/core/downloader.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { downloadImage, type Deps } from '../../src/core/downloader';
import type { ExtractedImage } from '../../src/types';

const img: ExtractedImage = {
  index: 1,
  fileId: 'notes_pre_post/abc',
  declaredWidth: 3106,
  declaredHeight: 4096,
  isLive: false,
  urlDefault: 'http://cdn/dft.webp',
  urlPre: 'http://cdn/pre.webp',
};

function makeDeps(handlers: Record<string, { status?: number; type?: string; size?: number }>): Deps {
  return {
    fetch: (async (url: string) => {
      const h = handlers[url];
      if (!h) return { ok: false, status: 404, headers: new Headers() } as unknown as Response;
      const status = h.status ?? 200;
      const body = new Uint8Array(h.size ?? 8);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': h.type ?? 'image/jpeg' }),
        arrayBuffer: async () => body.buffer,
        blob: async () => new Blob([body]),
      } as unknown as Response;
    }) as unknown as typeof fetch,
    async decode() { return { width: 3106, height: 4096 }; },
    async sha256() { return 'fakehash'; },
  };
}

describe('downloadImage', () => {
  it('原图可解码且尺寸匹配时接受', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg', size: 1000 },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('original');
    expect(r.ext).toBe('jpg');
    expect(r.width).toBe(3106);
    expect(r.bytes.byteLength).toBe(1000);
  });

  it('HEIC 原图被跳过，降级到 WB_DFT', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/heic' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/heic' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    expect(r.ext).toBe('webp');
  });

  it('第一个 host 失败时用第二个 host', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { status: 403 },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/jpeg' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('original');
    expect(r.sourceUrl).toBe('https://ci.xiaohongshu.com/notes_pre_post/abc');
  });

  it('尺寸与声明不符时降级', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/jpeg' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    deps.decode = async () => ({ width: 100, height: 100 });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    // 降级图不做尺寸校验，记录解码所得
    expect(r.width).toBe(100);
  });

  it('非图片 Content-Type 被跳过', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'text/html' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'text/html' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
  });

  it('全部候选失败时抛错并带 index', async () => {
    await expect(downloadImage(img, makeDeps({}))).rejects.toThrow(/第 1 张/);
  });

  it('返回 sha256', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg' },
    });
    expect((await downloadImage(img, deps)).sha256).toBe('fakehash');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/downloader.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/downloader.ts`:
```ts
import type { ExtractedImage, SourceKind } from '../types';
import { candidatesFor, extensionFor, isDecodable } from './image-source';

export interface Deps {
  fetch: typeof fetch;
  decode(b: Blob): Promise<{ width: number; height: number }>;
  sha256(b: ArrayBuffer): Promise<string>;
}

export interface FetchedImage {
  bytes: Uint8Array;
  ext: string;
  sourceKind: SourceKind;
  sourceUrl: string;
  width: number;
  height: number;
  sha256: string;
}

export const defaultDeps: Deps = {
  fetch: (...a) => fetch(...a),
  async decode(b) {
    const bmp = await createImageBitmap(b);
    const dim = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dim;
  },
  async sha256(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  },
};

/**
 * 按候选顺序尝试，返回第一个可用的。
 * 原图必须通过尺寸校验；HEIC 无法在 Chrome 中解码，直接跳过改用降级图。
 */
export async function downloadImage(img: ExtractedImage, deps: Deps): Promise<FetchedImage> {
  const reasons: string[] = [];

  for (const c of candidatesFor(img)) {
    let res: Response;
    try {
      res = await deps.fetch(c.url);
    } catch (e) {
      reasons.push(`${c.url} 请求异常`);
      continue;
    }
    if (!res.ok) {
      reasons.push(`${c.url} HTTP ${res.status}`);
      continue;
    }

    const contentType = res.headers.get('content-type') ?? '';
    const ext = extensionFor(contentType);
    if (!ext) {
      reasons.push(`${c.url} 非图片类型 ${contentType}`);
      continue;
    }

    // HEIC 无法解码，且下游兼容性差。原图凭 file_id 随时可重取，故直接降级。
    if (c.kind === 'original' && !isDecodable(contentType)) {
      reasons.push(`${c.url} 为 ${contentType}，无法解码`);
      continue;
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const blob = new Blob([bytes], { type: contentType });

    let dim = { width: img.declaredWidth, height: img.declaredHeight };
    if (isDecodable(contentType)) {
      try {
        dim = await deps.decode(blob);
      } catch {
        reasons.push(`${c.url} 解码失败`);
        continue;
      }
      // 只有原图需要与声明尺寸一致；降级图本就是 1080 宽的派生图。
      if (c.kind === 'original' && (dim.width !== img.declaredWidth || dim.height !== img.declaredHeight)) {
        reasons.push(`${c.url} 尺寸 ${dim.width}x${dim.height} 与声明不符`);
        continue;
      }
    }

    return {
      bytes,
      ext,
      sourceKind: c.kind,
      sourceUrl: c.url,
      width: dim.width,
      height: dim.height,
      sha256: await deps.sha256(buf),
    };
  }

  throw new Error(`第 ${img.index} 张图片全部候选均失败：${reasons.join('；')}`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/downloader.test.ts`
Expected: PASS，全部 7 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/core/downloader.ts tests/core/downloader.test.ts
git commit -m "feat: 图片下载与降级"
```

---

### Task 10: 归档编排

**Files:**
- Create: `src/core/archiver.ts`
- Create: `tests/core/archiver.test.ts`

**Interfaces:**
- Consumes: 全部前置核心模块
- Produces:
  - `checkNote(store: Store, noteId: string, collector: string): Promise<CheckResult>`
  - `archive(opts: ArchiveOptions): Promise<ArchiveResult>`
  - `type CheckResult = { state: 'new' } | { state: 'mine'; pointer: Pointer; duplicates: Pointer[] } | { state: 'others'; pointers: Pointer[] }`
  - `interface ArchiveOptions { store: Store; note: ExtractedNote; collector: string; datasetPath: string; mode: 'new' | 'update' | 'migrate'; existing?: Pointer; deps?: Deps; onProgress?(done: number, total: number): void }`

- [ ] **Step 1: 写失败测试**

`tests/core/archiver.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { checkNote, archive } from '../../src/core/archiver';
import { writePointer, lookup } from '../../src/core/index-store';
import { extract } from '../../src/core/extractor';
import type { Deps } from '../../src/core/downloader';
import type { ExtractedNote, RawNote, Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';

const NOTE_ID = '6a030b860000000036000201';

function goodNote(): ExtractedNote {
  const r = extract(imageNote as unknown as RawNote);
  if (!r.ok) throw new Error('fixture 应当可解析');
  return r.note;
}

function okDeps(): Deps {
  return {
    fetch: (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    })) as unknown as typeof fetch,
    async decode() { return { width: 3106, height: 4096 }; },
    async sha256() { return 'hash'; },
  };
}

function failingDeps(): Deps {
  return { ...okDeps(), fetch: (async () => ({ ok: false, status: 500, headers: new Headers() })) as unknown as typeof fetch };
}

const ptr = (collector: string, path: string): Pointer => ({
  note_id: NOTE_ID, path, collector, title: 't',
  first_archived_at: '2026-08-01T10:00:00+08:00',
  last_archived_at: '2026-08-01T10:00:00+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('checkNote', () => {
  it('未采集返回 new', async () => {
    expect(await checkNote(store, NOTE_ID, 'zach')).toEqual({ state: 'new' });
  });

  it('自己采过返回 mine', async () => {
    await writePointer(store, ptr('zach', `zach/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('mine');
  });

  it('他人采过返回 others', async () => {
    await writePointer(store, ptr('alice', `alice/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('others');
    if (r.state !== 'others') throw new Error();
    expect(r.pointers[0]!.collector).toBe('alice');
  });

  it('自己和他人都采过时以 mine 为准，并带出重复项', async () => {
    await writePointer(store, ptr('zach', `zach/2026-08-01/${NOTE_ID}`));
    await writePointer(store, ptr('alice', `alice/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('mine');
    if (r.state !== 'mine') throw new Error();
    expect(r.duplicates.map((d) => d.collector)).toEqual(['alice']);
  });
});

describe('archive - 新采集', () => {
  it('写入 note.json、图片与指针', async () => {
    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
    });
    expect(res.status).toBe('complete');
    expect(res.path).toBe(`zach/2026-08-03/${NOTE_ID}`);

    const txt = await store.readText(`zach/2026-08-03/${NOTE_ID}/note.json`);
    expect(txt).not.toBeNull();
    const j = JSON.parse(txt!);
    expect(j.images[0].file).toBe('images/01.jpg');
    expect(j.images[0].file_id).toBe('notes_pre_post/1040g3k83202lbd8f48005qcgi63ocap3qtle3do');
    expect(j.archive.collector).toBe('zach');
    expect(j.archive.archive_count).toBe(1);
    expect(j.archive.status).toBe('complete');
    expect(j.url).not.toContain('xsec_token');

    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/images/01.jpg`)).toBe(true);
    expect(await lookup(store, NOTE_ID)).toHaveLength(1);
  });

  it('图片全部失败时标记 partial 且不写指针', async () => {
    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: failingDeps(),
    });
    expect(res.status).toBe('partial');
    // 指针不存在 —— 查重永不产生假阳性
    expect(await lookup(store, NOTE_ID)).toEqual([]);
  });

  it('汇报进度', async () => {
    const seen: number[] = [];
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-03',
      mode: 'new', deps: okDeps(), onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1]);
  });
});

describe('archive - 更新原处', () => {
  it('保留首采时间，递增计数，路径不变', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const before = JSON.parse((await store.readText(`zach/2026-08-01/${NOTE_ID}/note.json`))!);

    const existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'update', existing, deps: okDeps(),
    });

    const after = JSON.parse((await store.readText(`zach/2026-08-01/${NOTE_ID}/note.json`))!);
    expect(after.archive.first_archived_at).toBe(before.archive.first_archived_at);
    expect(after.archive.archive_count).toBe(2);
    // 没有写到新的数据集路径
    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/note.json`)).toBe(false);
  });
});

describe('archive - 迁移', () => {
  it('写新位置后删除旧目录，指针指向新路径', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'migrate', existing, deps: okDeps(),
    });

    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/note.json`)).toBe(true);
    expect(await store.exists(`zach/2026-08-01/${NOTE_ID}/note.json`)).toBe(false);

    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.path).toBe(`zach/2026-08-03/${NOTE_ID}`);
  });

  it('迁移失败时不删除旧目录', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'migrate', existing, deps: failingDeps(),
    });

    expect(res.status).toBe('partial');
    expect(await store.exists(`zach/2026-08-01/${NOTE_ID}/note.json`)).toBe(true);
    expect((await lookup(store, NOTE_ID))[0]!.path).toBe(`zach/2026-08-01/${NOTE_ID}`);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/archiver.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/core/archiver.ts`:
```ts
import type { ExtractedNote, ImageRecord, NoteRecord, Pointer } from '../types';
import type { Store } from './store';
import { downloadImage, defaultDeps, type Deps, type FetchedImage } from './downloader';
import { lookup, writePointer } from './index-store';
import { serializeNote } from './serialize';
import { nowBeijingIso } from './time';

export type CheckResult =
  | { state: 'new' }
  | { state: 'mine'; pointer: Pointer; duplicates: Pointer[] }
  | { state: 'others'; pointers: Pointer[] };

export interface ArchiveOptions {
  store: Store;
  note: ExtractedNote;
  collector: string;
  datasetPath: string;
  mode: 'new' | 'update' | 'migrate';
  existing?: Pointer;
  deps?: Deps;
  onProgress?(done: number, total: number): void;
}

export interface ArchiveResult {
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
}

export async function checkNote(store: Store, noteId: string, collector: string): Promise<CheckResult> {
  const all = await lookup(store, noteId);
  if (all.length === 0) return { state: 'new' };
  const mine = all.find((p) => p.collector === collector);
  if (mine) return { state: 'mine', pointer: mine, duplicates: all.filter((p) => p !== mine) };
  return { state: 'others', pointers: all };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 归档一篇笔记。
 *
 * 原子性保证：全部图片先下载到内存，成功后才写盘，最后写指针。
 * 因此「指针存在」永远蕴含「数据完整」，查重不会产生假阳性。
 */
export async function archive(opts: ArchiveOptions): Promise<ArchiveResult> {
  const { store, note, collector, mode, existing } = opts;
  const deps = opts.deps ?? defaultDeps;
  const targetPath = mode === 'update' && existing ? existing.path : `${opts.datasetPath}/${note.noteId}`;

  // 1. 先把全部图片取到内存，任何一张失败都不落盘。
  const fetched: FetchedImage[] = [];
  const failures: string[] = [];
  for (const img of note.images) {
    try {
      fetched.push(await downloadImage(img, deps));
      opts.onProgress?.(fetched.length, note.images.length);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  const now = nowBeijingIso();

  if (failures.length > 0) {
    // 不写指针：残缺目录在语义上等同「未采集」，下次重采会直接覆盖。
    return { status: 'partial', path: targetPath, failures };
  }

  // 2. 组装 note.json
  const images: ImageRecord[] = fetched.map((f, i) => {
    const src = note.images[i]!;
    return {
      index: src.index,
      file: `images/${pad2(src.index)}.${f.ext}`,
      is_live: src.isLive,
      file_id: src.fileId,
      width: f.width,
      height: f.height,
      declared_width: src.declaredWidth,
      declared_height: src.declaredHeight,
      bytes: f.bytes.byteLength,
      sha256: f.sha256,
      source_kind: f.sourceKind,
      source_url: f.sourceUrl,
    };
  });

  const prior = mode === 'new' ? null : existing ?? null;
  const priorCount = prior ? await readArchiveCount(store, prior.path) : 0;

  const record: NoteRecord = {
    schema_version: 1,
    note_id: note.noteId,
    url: note.url,
    type: 'normal',
    title: note.title,
    content: note.content,
    tags: note.tags,
    published_at: note.publishedAt,
    author: note.author,
    interact: note.interact,
    images,
    archive: {
      first_archived_at: prior ? prior.first_archived_at : now,
      last_archived_at: now,
      collector,
      archive_count: priorCount + 1,
      status: 'complete',
    },
    raw: note.raw,
  };

  // 3. 写数据
  await store.writeFile(`${targetPath}/note.json`, serializeNote(record));
  for (let i = 0; i < fetched.length; i++) {
    await store.writeFile(`${targetPath}/${images[i]!.file}`, fetched[i]!.bytes);
  }

  // 4. 写指针（数据已完整）
  await writePointer(store, {
    note_id: note.noteId,
    path: targetPath,
    collector,
    title: note.title,
    first_archived_at: record.archive.first_archived_at,
    last_archived_at: now,
  });

  // 5. 迁移：新位置确认无误后才删旧目录。
  //    任何中断最坏留下孤儿目录，绝不会「删了旧的但新的没写成」。
  if (mode === 'migrate' && existing && existing.path !== targetPath) {
    await store.removeDir(existing.path);
    await removeEmptyParent(store, existing.path);
  }

  return { status: 'complete', path: targetPath, failures: [] };
}

async function readArchiveCount(store: Store, path: string): Promise<number> {
  const txt = await store.readText(`${path}/note.json`);
  if (txt === null) return 0;
  try {
    const j = JSON.parse(txt) as NoteRecord;
    return typeof j.archive?.archive_count === 'number' ? j.archive.archive_count : 0;
  } catch {
    return 0;
  }
}

/** 迁移后清理因此变空的日期目录，但不删采集者目录。 */
async function removeEmptyParent(store: Store, path: string): Promise<void> {
  const parts = path.split('/');
  if (parts.length < 3) return;
  const parent = parts.slice(0, -1).join('/');
  if ((await store.listDir(parent)).length === 0) await store.removeDir(parent);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/archiver.test.ts`
Expected: PASS，全部 10 个用例。

- [ ] **Step 5: 全量测试**

Run: `npm test`
Expected: PASS，所有测试文件。

- [ ] **Step 6: 提交**

```bash
git add src/core/archiver.ts tests/core/archiver.test.ts
git commit -m "feat: 归档编排与原子性保证"
```

---

### Task 11: 页面读取与标签页识别

**Files:**
- Create: `src/page/read-note.ts`
- Create: `tests/page/read-note.test.ts`

**Interfaces:**
- Consumes: `RawNote`（Task 2）
- Produces:
  - `readNoteFromPage(): PageReadResult`（**注入 MAIN world 执行，不可引用模块外任何变量**）
  - `type PageReadResult = { ok: true; raw: RawNote } | { ok: false; reason: 'no_state' | 'no_note' }`
  - `parseNoteUrl(url: string): string | null`
  - `readNoteViaTab(tabId: number): Promise<PageReadResult>`

- [ ] **Step 1: 写失败测试**

`tests/page/read-note.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readNoteFromPage, parseNoteUrl } from '../../src/page/read-note';

describe('parseNoteUrl', () => {
  it('识别独立页与 modal（两者 URL 形态相同）', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore/6a030b86?xsec_token=X')).toBe('6a030b86');
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore/6a030b86')).toBe('6a030b86');
  });
  it('识别用户主页下的笔记链接', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/user/profile/u1/6a030b86?x=1')).toBe('6a030b86');
  });
  it('非笔记页返回 null', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore')).toBeNull();
    expect(parseNoteUrl('https://www.xiaohongshu.com/search_result?keyword=x')).toBeNull();
    expect(parseNoteUrl('https://example.com/explore/abc')).toBeNull();
  });
});

describe('readNoteFromPage', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).__INITIAL_STATE__; });

  function setState(state: unknown) {
    (globalThis as Record<string, unknown>).window = globalThis;
    (globalThis as Record<string, unknown>).__INITIAL_STATE__ = state;
  }

  it('无全局变量时返回 no_state', () => {
    (globalThis as Record<string, unknown>).window = globalThis;
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_state' });
  });

  it('用 currentNoteId._value 定位，忽略脏 key', () => {
    setState({
      note: {
        currentNoteId: { _value: 'real' },
        noteDetailMap: {
          '': { note: { noteId: 'empty-key' } },
          undefined: { note: { noteId: 'undefined-key' } },
          real: { note: { noteId: 'real', type: 'normal' } },
        },
      },
    });
    const r = readNoteFromPage();
    expect(r).toEqual({ ok: true, raw: { noteId: 'real', type: 'normal' } });
  });

  it('currentNoteId 缺失时返回 no_note', () => {
    setState({ note: { noteDetailMap: { real: { note: { noteId: 'real' } } } } });
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_note' });
  });

  it('map 中无对应条目时返回 no_note', () => {
    setState({ note: { currentNoteId: { _value: 'missing' }, noteDetailMap: {} } });
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_note' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/page/read-note.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/page/read-note.ts`:
```ts
import type { RawNote } from '../types';

export type PageReadResult =
  | { ok: true; raw: RawNote }
  | { ok: false; reason: 'no_state' | 'no_note' };

/**
 * 注入到页面 MAIN world 执行。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**
 * （包括 import 的类型以外的一切）。
 *
 * 登录态下 __INITIAL_STATE__ 是持续存在的 Vue 响应式 store，
 * 三种入口（独立页 / 首页 modal / 搜索 modal）均可读到完整数据。
 */
export function readNoteFromPage(): PageReadResult {
  const state = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
  if (!state || typeof state !== 'object') return { ok: false, reason: 'no_state' };

  const noteStore = state.note as
    | { currentNoteId?: { _value?: unknown }; noteDetailMap?: Record<string, { note?: unknown }> }
    | undefined;
  if (!noteStore) return { ok: false, reason: 'no_note' };

  // 必须用 currentNoteId._value：noteDetailMap 含 "" 与 "undefined" 脏 key。
  const id = noteStore.currentNoteId?._value;
  if (typeof id !== 'string' || id === '') return { ok: false, reason: 'no_note' };

  const entry = noteStore.noteDetailMap?.[id];
  if (!entry || !entry.note) return { ok: false, reason: 'no_note' };

  // 只取 .note 子对象：其父层含 dep/computed 循环引用，无法穿过扩展边界。
  return { ok: true, raw: structuredClone(entry.note) as RawNote };
}

const NOTE_URL_RE = /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]+)/;

export function parseNoteUrl(url: string): string | null {
  return NOTE_URL_RE.exec(url)?.[1] ?? null;
}

export async function readNoteViaTab(tabId: number): Promise<PageReadResult> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readNoteFromPage,
  });
  return (res?.result as PageReadResult | undefined) ?? { ok: false, reason: 'no_state' };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/page/read-note.test.ts`
Expected: PASS，全部 7 个用例。

`structuredClone` 在 Node 18+ 全局可用，测试无需 polyfill。

- [ ] **Step 5: 提交**

```bash
git add src/page/read-note.ts tests/page/read-note.test.ts
git commit -m "feat: 页面笔记读取与 URL 识别"
```

---

### Task 12: 侧边栏状态机与界面

**Files:**
- Create: `src/sidepanel/usePanelState.ts`
- Modify: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/components/Setup.tsx`, `src/sidepanel/components/NoteView.tsx`
- Create: `tests/sidepanel/panel-state.test.ts`

**Interfaces:**
- Consumes: `checkNote` / `archive`（Task 10）、`parseNoteUrl` / `readNoteViaTab`（Task 11）、`extract`（Task 2）、settings 与 handle-store（Task 7）
- Produces:
  - `type PanelState`（见下）
  - `resolvePanelState(input: ResolveInput): Promise<PanelState>`

- [ ] **Step 1: 写状态判定的失败测试**

`tests/sidepanel/panel-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolvePanelState, type ResolveInput } from '../../src/sidepanel/usePanelState';
import { createStore } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import type { Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import videoNote from '../fixtures/note-video.json';

const NOTE_ID = '6a030b860000000036000201';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=X`;

function baseInput(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    hasRoot: true,
    store: createStore(memRoot()),
    collector: 'zach',
    tabUrl: NOTE_URL,
    readNote: async () => ({ ok: true, raw: imageNote as never }),
    ...over,
  };
}

const ptr = (collector: string): Pointer => ({
  note_id: NOTE_ID, path: `${collector}/2026-08-01/${NOTE_ID}`, collector, title: 't',
  first_archived_at: '2026-08-01T10:00:00+08:00',
  last_archived_at: '2026-08-01T10:00:00+08:00',
});

describe('resolvePanelState 优先级', () => {
  it('未授权目录优先于一切', async () => {
    const s = await resolvePanelState(baseInput({ hasRoot: false, collector: null }));
    expect(s.kind).toBe('need_root');
  });

  it('未设采集者 ID 次之', async () => {
    const s = await resolvePanelState(baseInput({ collector: null }));
    expect(s.kind).toBe('need_collector');
  });

  it('非小红书页', async () => {
    const s = await resolvePanelState(baseInput({ tabUrl: 'https://example.com/' }));
    expect(s.kind).toBe('not_xhs');
  });

  it('小红书但非笔记页', async () => {
    const s = await resolvePanelState(baseInput({ tabUrl: 'https://www.xiaohongshu.com/explore' }));
    expect(s.kind).toBe('not_note');
  });

  it('读不到页面数据', async () => {
    const s = await resolvePanelState(baseInput({ readNote: async () => ({ ok: false, reason: 'no_state' }) }));
    expect(s.kind).toBe('unreadable');
  });

  it('视频笔记被拒绝', async () => {
    const s = await resolvePanelState(baseInput({ readNote: async () => ({ ok: true, raw: videoNote as never }) }));
    expect(s.kind).toBe('video_rejected');
  });

  it('他人已采集时阻止', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('alice'));
    const s = await resolvePanelState(baseInput({ store }));
    expect(s.kind).toBe('blocked_by_other');
    if (s.kind !== 'blocked_by_other') throw new Error();
    expect(s.pointers[0]!.collector).toBe('alice');
  });

  it('自己已采集时可更新或迁移', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('zach'));
    const s = await resolvePanelState(baseInput({ store }));
    expect(s.kind).toBe('mine');
  });

  it('全新笔记就绪可采', async () => {
    const s = await resolvePanelState(baseInput());
    expect(s.kind).toBe('ready');
    if (s.kind !== 'ready') throw new Error();
    expect(s.note.noteId).toBe(NOTE_ID);
  });

  it('存在多个指针时带出重复提示', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('zach'));
    await writePointer(store, ptr('bob'));
    const s = await resolvePanelState(baseInput({ store }));
    if (s.kind !== 'mine') throw new Error();
    expect(s.duplicates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/sidepanel/panel-state.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现状态判定**

`src/sidepanel/usePanelState.ts`:
```ts
import type { ExtractedNote, Pointer, RawNote } from '../types';
import type { Store } from '../core/store';
import { extract } from '../core/extractor';
import { checkNote } from '../core/archiver';
import { parseNoteUrl, type PageReadResult } from '../page/read-note';

export type PanelState =
  | { kind: 'need_root' }
  | { kind: 'need_collector' }
  | { kind: 'not_xhs' }
  | { kind: 'not_note' }
  | { kind: 'unreadable'; reason: 'no_state' | 'no_note' }
  | { kind: 'video_rejected' }
  | { kind: 'blocked_by_other'; pointers: Pointer[] }
  | { kind: 'mine'; note: ExtractedNote; pointer: Pointer; duplicates: Pointer[] }
  | { kind: 'ready'; note: ExtractedNote };

export interface ResolveInput {
  hasRoot: boolean;
  store: Store;
  collector: string | null;
  tabUrl: string;
  readNote(): Promise<PageReadResult>;
}

/** 顺序即优先级，与设计文档第 8 节的状态机一致。 */
export async function resolvePanelState(input: ResolveInput): Promise<PanelState> {
  if (!input.hasRoot) return { kind: 'need_root' };
  if (!input.collector) return { kind: 'need_collector' };

  if (!/^https:\/\/(?:www\.)?xiaohongshu\.com\//.test(input.tabUrl)) return { kind: 'not_xhs' };
  if (parseNoteUrl(input.tabUrl) === null) return { kind: 'not_note' };

  const read = await input.readNote();
  if (!read.ok) return { kind: 'unreadable', reason: read.reason };

  const ext = extract(read.raw as RawNote);
  if (!ext.ok) {
    return ext.reason === 'unsupported_video'
      ? { kind: 'video_rejected' }
      : { kind: 'unreadable', reason: 'no_note' };
  }

  const check = await checkNote(input.store, ext.note.noteId, input.collector);
  if (check.state === 'others') return { kind: 'blocked_by_other', pointers: check.pointers };
  if (check.state === 'mine') {
    return { kind: 'mine', note: ext.note, pointer: check.pointer, duplicates: check.duplicates };
  }
  return { kind: 'ready', note: ext.note };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/sidepanel/panel-state.test.ts`
Expected: PASS，全部 10 个用例。

- [ ] **Step 5: 实现界面组件**

`src/sidepanel/components/Setup.tsx`:
```tsx
import { useState } from 'react';
import { isValidSegment, randomCollectorId } from '../../core/settings';

export function RootSetup({ onPick }: { onPick(): void }) {
  return (
    <section>
      <h2>选择数据仓库目录</h2>
      <p>请选择采集数据要存放的根目录。它应当是一个独立的 Git 仓库，与插件代码分开。</p>
      <button onClick={onPick}>选择目录…</button>
    </section>
  );
}

export function CollectorSetup({ onSave }: { onSave(id: string): void }) {
  const [value, setValue] = useState(randomCollectorId());
  const valid = isValidSegment(value);
  return (
    <section>
      <h2>设置采集者 ID</h2>
      <p>它会成为目录名，建议改成方便辨认的名字。只能用小写字母、数字、连字符和下划线。</p>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
      {!valid && <p style={{ color: 'crimson' }}>只能包含 a-z、0-9、-、_，且不超过 32 字符</p>}
      <button disabled={!valid} onClick={() => onSave(value)}>保存</button>
    </section>
  );
}
```

`src/sidepanel/components/NoteView.tsx`:
```tsx
import type { PanelState } from '../usePanelState';

export function NoteView({
  state, datasetPath, onDatasetPathChange, onArchive, progress, message,
}: {
  state: PanelState;
  datasetPath: string;
  onDatasetPathChange(v: string): void;
  onArchive(mode: 'new' | 'update' | 'migrate'): void;
  progress: { done: number; total: number } | null;
  message: string | null;
}) {
  if (state.kind === 'not_xhs') return <p>当前标签页不是小红书。</p>;
  if (state.kind === 'not_note') return <p>请打开一篇笔记后再采集。</p>;
  if (state.kind === 'unreadable') {
    return <p>读不到页面数据（{state.reason}）。请确认已登录小红书，并刷新页面重试。</p>;
  }
  if (state.kind === 'video_rejected') return <p>这是一篇视频笔记，本工具不采集视频。</p>;

  if (state.kind === 'blocked_by_other') {
    return (
      <section>
        <p>这篇已被他人采集，不重复采集。</p>
        <ul>
          {state.pointers.map((p) => (
            <li key={p.collector}>
              <b>{p.collector}</b> 于 {p.last_archived_at} 采集<br />
              <code>{p.path}</code>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          若对方数据有问题需要接管，删除对应的 <code>_index</code> 指针文件即可解除。
        </p>
      </section>
    );
  }

  const note = state.kind === 'mine' || state.kind === 'ready' ? state.note : null;
  if (!note) return null;

  return (
    <section>
      <h3>{note.title || '(无标题)'}</h3>
      <p style={{ fontSize: 12 }}>
        {note.images.length} 张图 · 赞 {note.interact.liked} · 藏 {note.interact.collected}
      </p>

      <label>
        写入路径
        <input value={datasetPath} onChange={(e) => onDatasetPathChange(e.target.value)} />
      </label>

      {state.kind === 'mine' && (
        <>
          <p>
            你已于 {state.pointer.last_archived_at} 采集过，位于 <code>{state.pointer.path}</code>
          </p>
          {state.duplicates.length > 0 && (
            <p style={{ color: 'darkorange' }}>
              这篇存在 {state.duplicates.length + 1} 份重复采集：
              {state.duplicates.map((d) => d.path).join('、')}
            </p>
          )}
          <button onClick={() => onArchive('update')}>更新原位置</button>
          <button onClick={() => onArchive('migrate')}>
            迁移到当前路径（将删除 {state.pointer.path}）
          </button>
        </>
      )}

      {state.kind === 'ready' && <button onClick={() => onArchive('new')}>采集这篇</button>}

      {progress && <p>下载中 {progress.done}/{progress.total}</p>}
      {message && <p>{message}</p>}
    </section>
  );
}
```

- [ ] **Step 6: 组装 App**

`src/sidepanel/App.tsx`（整体替换 Task 1 的占位内容）:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { createStore, type Store } from '../core/store';
import { loadRootHandle, saveRootHandle, ensurePermission } from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { readNoteViaTab } from '../page/read-note';
import { resolvePanelState, type PanelState } from './usePanelState';
import { RootSetup, CollectorSetup } from './components/Setup';
import { NoteView } from './components/NoteView';

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [collector, setCollector] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState('');
  const [state, setState] = useState<PanelState>({ kind: 'need_root' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const attachRoot = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensurePermission(handle))) {
      setMessage('目录授权未通过，请重新选择。');
      return;
    }
    const s = createStore(handle);
    const created = await ensureRepoTemplates(s);
    setStore(s);
    setRootName(handle.name);
    if (created.length > 0) setMessage(`已初始化仓库模板：${created.join('、')}`);
  }, []);

  // 恢复已保存的目录句柄与设置
  useEffect(() => {
    void (async () => {
      const st = await loadSettings(chromeLocalArea);
      setCollector(st.collector);
      const handle = await loadRootHandle();
      if (handle && (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
        await attachRoot(handle);
      }
      setDatasetPath(st.datasetPath ?? (st.collector ? defaultDatasetPath(st.collector) : ''));
    })();
  }, [attachRoot]);

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setState(
      await resolvePanelState({
        hasRoot: store !== null,
        store: store ?? createStore({} as FileSystemDirectoryHandle),
        collector,
        tabUrl: tab?.url ?? '',
        readNote: () => readNoteViaTab(tab!.id!),
      }),
    );
  }, [store, collector]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 切换标签页或页面内导航（modal 打开/关闭会改 URL）时重新判定
  useEffect(() => {
    const onChange = () => { void refresh(); };
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener(onChange);
    return () => {
      chrome.tabs.onActivated.removeListener(onChange);
      chrome.tabs.onUpdated.removeListener(onChange);
    };
  }, [refresh]);

  async function pickRoot() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveRootHandle(handle);
    await attachRoot(handle);
  }

  async function saveCollector(id: string) {
    const path = defaultDatasetPath(id);
    await saveSettings(chromeLocalArea, { collector: id, datasetPath: path });
    setCollector(id);
    setDatasetPath(path);
  }

  async function doArchive(mode: 'new' | 'update' | 'migrate') {
    if (!store || !collector) return;
    if (state.kind !== 'ready' && state.kind !== 'mine') return;
    if (!isValidDatasetPath(datasetPath)) {
      setMessage('写入路径不合法：每一段只能是小写字母、数字、连字符、下划线。');
      return;
    }
    setMessage(null);
    setProgress({ done: 0, total: state.note.images.length });
    const res = await archive({
      store,
      note: state.note,
      collector,
      datasetPath,
      mode,
      existing: state.kind === 'mine' ? state.pointer : undefined,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setProgress(null);
    setMessage(
      res.status === 'complete'
        ? `已采集到 ${res.path}`
        : `部分失败，未写入索引：${res.failures.join('；')}`,
    );
    await saveSettings(chromeLocalArea, { collector, datasetPath });
    await refresh();
  }

  return (
    <main style={{ padding: 12, fontFamily: 'system-ui', fontSize: 14, lineHeight: 1.6 }}>
      <header style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        仓库：{rootName ?? '未选择'}
        {rootName && <button style={{ marginLeft: 8 }} onClick={pickRoot}>切换</button>}
      </header>

      {state.kind === 'need_root' && <RootSetup onPick={pickRoot} />}
      {state.kind === 'need_collector' && <CollectorSetup onSave={saveCollector} />}
      {state.kind !== 'need_root' && state.kind !== 'need_collector' && (
        <NoteView
          state={state}
          datasetPath={datasetPath}
          onDatasetPathChange={setDatasetPath}
          onArchive={doArchive}
          progress={progress}
          message={message}
        />
      )}
      {message && (state.kind === 'need_root' || state.kind === 'need_collector') && <p>{message}</p>}
    </main>
  );
}
```

- [ ] **Step 7: 构建并全量测试**

Run: `npm test && npm run build`
Expected: 测试全部 PASS，构建无错误。

- [ ] **Step 8: 提交**

```bash
git add src/sidepanel tests/sidepanel
git commit -m "feat: 侧边栏状态机与界面"
```

---

### Task 13: 端到端验收

**Files:**
- Create: `docs/manual-acceptance.md`

**Interfaces:**
- Consumes: 全部
- Produces: 一份填写完成的验收记录

- [ ] **Step 1: 准备数据仓库**

```bash
mkdir -p ~/xhs-data && cd ~/xhs-data && git init && git lfs install
```

若 `git lfs` 未安装：`brew install git-lfs`。

- [ ] **Step 2: 加载扩展并逐项验证**

Run: `npm run build`，然后在 `chrome://extensions` 重新加载 `dist/`。

创建 `docs/manual-acceptance.md`，逐条执行并记录实际结果：

```markdown
# 手工验收记录

日期：____  验收人：____

| # | 场景 | 预期 | 实际 |
|---|---|---|---|
| 1 | 首次打开侧边栏 | 提示选择数据仓库目录 | |
| 2 | 选择 ~/xhs-data | 生成 .gitattributes / .gitignore / README.md | |
| 3 | 未设采集者 ID | 提示设置，预填 4 位随机码 | |
| 4 | 输入「张三」 | 就地报错，保存按钮禁用 | |
| 5 | 输入 zach 保存 | 写入路径默认变为 zach/{今天} | |
| 6 | 停在百度页 | 提示「当前标签页不是小红书」 | |
| 7 | 小红书首页 | 提示「请打开一篇笔记」 | |
| 8 | 首页点开图文 modal | 显示标题、图片数、互动数，出现采集按钮 | |
| 9 | 点击采集 | 逐张进度，完成后提示路径 | |
| 10 | 检查磁盘 | note.json + images/ 齐全，编号与 json 一一对应 | |
| 11 | 检查 _index | `_index/{前两位}/{noteId}/zach.json` 存在 | |
| 12 | 同一篇再开侧边栏 | 显示上次采集时间与路径，出现「更新原位置」「迁移」 | |
| 13 | 点「更新原位置」 | archive_count 变 2，first_archived_at 不变 | |
| 14 | 改写入路径后点「迁移」 | 新路径出现数据，旧目录被删，指针指向新路径 | |
| 15 | 搜索结果页点开笔记 | 与首页 modal 表现一致 | |
| 16 | 独立页直接打开笔记 | 与 modal 表现一致 | |
| 17 | 打开视频笔记 | 提示「这是一篇视频笔记，本工具不采集视频」 | |
| 18 | 断网后点采集 | 提示部分失败，`_index` 中无指针 | |
| 19 | 恢复网络重采 | 成功，覆盖残缺目录 | |
| 20 | 手工造一个 alice.json 指针 | 侧边栏显示被他人采集，无采集按钮 | |
| 21 | 删除该 alice.json | 阻止解除，恢复可采 | |
| 22 | 采一篇 uhdr 笔记 | source_kind 为 WB_DFT，文件为 .webp | |
| 23 | 重启 Chrome 后打开侧边栏 | 自动恢复目录，或显示重新授权按钮 | |
| 24 | `git add -A && git status` | 图片走 LFS，json 为文本 | |
```

- [ ] **Step 3: 验证 JSON 稳定性**

```bash
cd ~/xhs-data
git add -A && git commit -m "首次采集"
```

在插件中对同一篇点「更新原位置」，然后：

```bash
git diff --stat
git diff -- '**/note.json' | head -40
```

Expected: diff 只出现在 `last_archived_at`、`archive_count` 与互动数上，**不出现字段顺序变化导致的整块重写**。若出现，说明 `sortKeysDeep` 未生效，需回到 Task 4 排查。

- [ ] **Step 4: 验证 LFS 生效**

```bash
git lfs ls-files | head
```

Expected: 列出 `images/` 下的文件。若为空，检查 `.gitattributes` 是否在首次 `git add` 之前就已存在。

- [ ] **Step 5: 提交验收记录**

```bash
git add docs/manual-acceptance.md
git commit -m "docs: 手工验收记录"
```

---

## 自查结果

**规格覆盖：** 设计文档 §3.1（数据仓库独立）→ Task 13 Step 1；§3.2（FSA 与授权恢复）→ Task 7；§3.3（Side Panel 执行）→ Task 12；§3.4（字符集）→ Task 7；§3.5（executeScript 读取、`currentNoteId._value`、只取 `.note`）→ Task 11；§4（目录结构与数据集路径）→ Task 6、10；§4.2（分桶指针目录）→ Task 6；§5（note.json 契约与固定顺序）→ Task 4；§5.1（不存 xsec_token）→ Task 2；§5.2（保留 raw）→ Task 2、4；§5.3（原图与 HEIC 降级）→ Task 3、9；§6（流程）→ Task 10；§6.1（原子性）→ Task 10；§6.2/6.3（自己/他人查重）→ Task 10、12；§6.4（并发竞态提示）→ Task 10、12；§6.5（视频拒绝）→ Task 2；§7（模块划分）→ File Structure；§8（状态机）→ Task 12；§10（技术栈与权限）→ Task 1；§12（模板与冲突指引）→ Task 8。

**未纳入 v1 的设计条目：** §5.1 的「复制原帖链接（含临时 token）」按钮、§11 的 v2/v3 全部功能。前者是独立小功能，可在 v1 收尾时追加；后者按设计文档明确排在后续迭代。

**类型一致性：** `Store` 接口在 Task 5 定义，Task 6、8、10、12 使用一致；`Deps` 在 Task 9 定义，Task 10 注入；`Pointer` 在 Task 2 定义，Task 4、6、10、12 一致；`ExtractedNote` 在 Task 2 定义，Task 10、12 一致；`SourceKind` 在 Task 2 定义，Task 3、9 一致。
