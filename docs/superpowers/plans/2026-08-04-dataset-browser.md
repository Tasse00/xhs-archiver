# 数据集浏览页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立标签页里只读浏览数据仓库——目录树、笔记列表、笔记详情、图片、评论、搜索排序与数据质量提示。

**Architecture:** 三栏（树 | 表格列表 | 可关详情栏）。全部判定与解析逻辑放在 `src/core/browse/`，只依赖注入的 `ReadStore`，可在 Node 下单测；`src/browser/` 只做 React 渲染与浏览器 API 接线。数据靠三层懒加载：树只列目录名，行滚进视口才读 `note.json`，图片缩到缩略图后原始 blob 立刻丢弃。

**Tech Stack:** Vite 6 + @crxjs/vite-plugin 2 + TypeScript 7 + React 19 + Vitest 3（`environment: 'node'`）。

**依据的设计文档：** `docs/superpowers/specs/2026-08-04-dataset-browser-design.md`。以下简称「设计 §N」。

## Global Constraints

- **核心层不碰 DOM 和 chrome API。** `src/core/` 下所有依赖通过参数注入。碰 `chrome.*`、`document`、`URL.createObjectURL` 的代码只能出现在 `src/browser/`、`src/sidepanel/`、`src/background/`、`src/page/`
- **浏览页的所有模块，存储参数类型一律写 `ReadStore`，绝不导入 `Store`。** 这是设计 §8.1 里「只读」的唯一保证——`queryPermission({mode:'read'})` 不降权，句柄本身仍是 readwrite
- **所有与磁盘内容对应的缓存，键是 `NoteKey`（`${datasetPath}/${noteId}`），不是 `noteId`。** 理由见设计 §5.3：竞态时同一篇存在于多个目录
- **不保留 `raw`。** 只从中取 `ipLocation` 一个值
- **不能用 `archive.status` 判断完整性。** 它在磁盘上恒为 `complete`（`src/core/archiver.ts` 的 partial 分支 `return` 在任何 `writeFile` 之前）
- note_id 形态判据：`/^[0-9a-f]{16,32}$/`
- 参数常量：行高 44px，overscan 8 行，缩略图并发上限 6，缩略图 LRU 300，原图 LRU 3
- 测试命令一律 `npx vitest run <路径>`；全量 `npm test`
- 中文回复、中文注释，注释写「为什么」不写「做了什么」
- 每个任务结束提交一次，commit message 见各任务最后一步

## 与设计文档的两处细化

以下两条是计划阶段定死的，已同步回设计文档（§5.4、§6.2），两边一致：

1. **共享类型放 `src/core/browse/types.ts`**（`NoteRef`、`NoteKey`、`DatasetNode`、`RowMeta`、`NoteDetail`）。`tree.ts` 与 `row-meta.ts` 互相需要类型，不抽出来会形成循环 import
2. **原图用独立的 LRU(3)**，与缩略图的 LRU(300) 分开。原图一张几 MB，混进 300 条的表里会一直占着内存不放，而它只在看图器打开时需要

## 文件结构

**新建（核心层，全部可单测）**

| 文件 | 职责 |
|---|---|
| `src/core/read-store.ts` | `ReadStore` 接口、`DirEntry`、`toReadStore()` 只读适配器 |
| `src/core/browse/types.ts` | 共享数据形状 |
| `src/core/browse/tree.ts` | `buildTree()`，数据集叶子判定 |
| `src/core/browse/scope.ts` | `noteKeyOf()`、`collectRefs()`、排序比较器 |
| `src/core/browse/row-meta.ts` | `loadNote()` → `RowMeta` + `NoteDetail` |
| `src/core/browse/comments.ts` | `loadComments()`、`commentImagePath()` |
| `src/core/browse/quality.ts` | `checkQuality()`，设计 §4.5 的六种状态 |
| `src/core/browse/search.ts` | `matches()`、`sortRefs()` |
| `src/core/browse/virtual.ts` | `visibleRange()` |
| `src/core/browse/lru.ts` | 泛型 LRU，淘汰时回调 |
| `src/core/browse/queue.ts` | 并发上限队列，支持启动前丢弃与启动后作废 |
| `src/core/browse/scan.ts` | `scanScope()`，进度与取消 |

**新建（UI 层，无单测，靠构建 + 浏览器验收）**

`src/styles/tokens.css`、`src/browser/{index.html,main.tsx,App.tsx,browser.css}`、`src/browser/components/{PermissionGate,Tree,Table,DetailPane,Lightbox,TopBar}.tsx`、`src/browser/hooks/{useThumbnail,useScope}.ts`、`src/sidepanel/open-browser.ts`

**修改**

| 文件 | 改什么 |
|---|---|
| `src/core/store.ts` | `Store extends ReadStore`；`createStore` 补 `readFile`、`listEntries` |
| `tests/helpers/memory-fs.ts` | 内部 Map 改名 `children`，补 `entries()`，`getFile()` 返回真实 `File` |
| `src/sidepanel/panel.css` | 顶部 token 与基础样式移出，改为 `@import` |
| `src/sidepanel/components/Icons.tsx` | 加 `IconBrowse` |
| `src/sidepanel/App.tsx` | 顶栏加入口按钮 |
| `vite.config.ts` | 加 `build.rollupOptions.input` |

---

### Task 1: 页面骨架与构建接线

先打通「侧边栏点一下 → 新标签页打开 → 看到权限门」这条链路。crxjs 对 manifest 之外的 HTML 入口是本功能最大的未知（设计 §7），先证明它能跑通，后面的活才有地方落。

**Files:**
- Create: `src/styles/tokens.css`, `src/browser/index.html`, `src/browser/main.tsx`, `src/browser/App.tsx`, `src/browser/browser.css`, `src/browser/components/PermissionGate.tsx`, `src/sidepanel/open-browser.ts`
- Modify: `src/sidepanel/panel.css:1-62`, `src/sidepanel/components/Icons.tsx`, `src/sidepanel/App.tsx`, `vite.config.ts`

**Interfaces:**
- Consumes: `loadRootHandle` from `src/core/handle-store.ts`；`createStore` from `src/core/store.ts`
- Produces: `openBrowser(): Promise<void>`；`<PermissionGate onReady={(store) => …} />`，`onReady` 的参数在 Task 2 之后是 `ReadStore`，本任务先用 `Store`

- [ ] **Step 1: 抽出样式 token**

把 `src/sidepanel/panel.css` 第 1 行到第 62 行（`:root` token 块、深色主题块、`* { box-sizing }`、`html, body, #root`、`body`、`code, .mono`、`button`、`:focus-visible`）整段剪切到新文件 `src/styles/tokens.css`，一个字都不改。

然后 `src/sidepanel/panel.css` 的第一行改成：

```css
@import '../styles/tokens.css';

/* 侧边栏专有样式。共享的 token 与基础重置在 tokens.css，两个页面必须用同一套。 */
```

- [ ] **Step 2: 创建浏览页骨架**

`src/browser/index.html`：

```html
<!doctype html>
<html lang="zh">
  <head><meta charset="utf-8" /><title>数据集浏览 · 小红书笔记归档</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`src/browser/browser.css`：

```css
@import '../styles/tokens.css';

/* 浏览页在整块屏幕上跑，字号比侧边栏大一档 */
body { font-size: 13px; background: var(--paper); }

.bw { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

.bw-gate {
  height: 100%; display: grid; place-items: center; text-align: center;
  padding: 24px; gap: 12px; grid-auto-flow: row; align-content: center;
}
.bw-gate p { color: var(--ink-2); max-width: 380px; margin: 0; }
.bw-gate button {
  padding: 8px 18px; border: 1px solid var(--line-2); border-radius: 8px;
  background: var(--surface); color: var(--ink);
}
.bw-gate button:hover { background: var(--sunk); }
```

`src/browser/main.tsx`：

```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './browser.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 3: 写权限门**

`src/browser/components/PermissionGate.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { loadRootHandle } from '../../core/handle-store';
import { createStore, type Store } from '../../core/store';

type Gate =
  | { kind: 'checking' }
  | { kind: 'no_root' }
  | { kind: 'need_permission'; handle: FileSystemDirectoryHandle }
  | { kind: 'ready' };

/**
 * 浏览页只读，所以只申请 read。注意这并不会把句柄降权——句柄仍是侧边栏
 * 用 readwrite 取得的那一个，「只读」由模块边界保证，见设计 §8.1。
 */
const MODE = { mode: 'read' as const };

export function PermissionGate({
  onReady,
  children,
}: {
  onReady(store: Store, rootName: string): void;
  children: React.ReactNode;
}) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });

  const attach = useCallback(
    (handle: FileSystemDirectoryHandle) => {
      onReady(createStore(handle), handle.name);
      setGate({ kind: 'ready' });
    },
    [onReady],
  );

  useEffect(() => {
    void (async () => {
      const handle = await loadRootHandle();
      if (!handle) return setGate({ kind: 'no_root' });
      // 页面加载时不能直接 requestPermission：它必须由用户手势触发，
      // 自动调用会被浏览器忽略，用户只会看到一个卡住的空页面。
      if ((await handle.queryPermission(MODE)) === 'granted') return attach(handle);
      setGate({ kind: 'need_permission', handle });
    })();
  }, [attach]);

  if (gate.kind === 'ready') return <>{children}</>;
  if (gate.kind === 'checking') return <div className="bw-gate"><p>正在连接数据仓库…</p></div>;
  if (gate.kind === 'no_root') {
    return (
      <div className="bw-gate">
        <p>还没有选择数据仓库目录。请在小红书页面打开侧边栏，先选好目录，再回到这里。</p>
      </div>
    );
  }
  return (
    <div className="bw-gate">
      <p>浏览数据仓库需要读取授权。浏览器要求这一步由你点击触发。</p>
      <button
        onClick={() => {
          void (async () => {
            if ((await gate.handle.requestPermission(MODE)) === 'granted') attach(gate.handle);
          })();
        }}
      >
        授权访问数据仓库
      </button>
    </div>
  );
}
```

`src/browser/App.tsx`：

```tsx
import { useState } from 'react';
import type { Store } from '../core/store';
import { PermissionGate } from './components/PermissionGate';

export function App() {
  const [rootName, setRootName] = useState('');

  return (
    <div className="bw">
      <PermissionGate onReady={(_store, name) => setRootName(name)}>
        <p style={{ padding: 16 }}>已连接数据仓库：{rootName}</p>
      </PermissionGate>
    </div>
  );
}
```

- [ ] **Step 4: 接上构建入口**

`vite.config.ts` 改为：

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // crxjs 只自动打包 manifest 里声明过的 HTML。浏览页不属于 popup/side_panel/
  // options 任何一种，必须显式作为 input 加进来。
  build: { rollupOptions: { input: { browser: 'src/browser/index.html' } } },
});
```

- [ ] **Step 5: 加侧边栏入口**

`src/sidepanel/components/Icons.tsx` 末尾追加：

```tsx
export function IconBrowse() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  );
}
```

新建 `src/sidepanel/open-browser.ts`：

```ts
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
```

`src/sidepanel/App.tsx`：在 `import { IconRefresh } from './components/Icons';` 改为同时引入 `IconBrowse`，并加一行 import：

```tsx
import { IconRefresh, IconBrowse } from './components/Icons';
import { openBrowser } from './open-browser';
```

在顶栏的刷新按钮**之前**插入（即 `<button className="icon-btn" title="重新读取页面"…>` 上面）：

```tsx
{configured && (
  <button className="icon-btn" title="浏览数据集" onClick={() => void openBrowser()}>
    <IconBrowse />
  </button>
)}
```

- [ ] **Step 6: 构建并在浏览器里验收**

Run: `npm run build`
Expected: 构建成功，且 `dist/` 下存在浏览页的 HTML 产物。用 `ls dist` 与 `grep -r "browser" dist/manifest.json` 确认产物路径。

**如果产物路径不是 `src/browser/index.html`**，把 `open-browser.ts` 里的 `BROWSER_PATH` 改成实际路径。**如果 crxjs 干脆没产出这个页面**，退到设计 §7 的备选：在 `manifest.config.ts` 里加 `options_page: 'src/browser/index.html'`，去掉 `rollupOptions.input`，并在本文件此处记下改用了备选方案。

然后在 `chrome://extensions` 重新加载 `dist/`，打开一篇小红书笔记，点侧边栏顶栏的新按钮，确认：

1. 新标签页打开，标题是「数据集浏览 · 小红书笔记归档」
2. 页面显示「已连接数据仓库：<目录名>」，或者显示授权按钮且点击后能连上
3. 再点一次侧边栏按钮，激活的是同一个标签页，没有开出第二个
4. 深浅主题切换后配色跟着变（说明 tokens.css 被两个页面共用了）
5. 侧边栏本身外观没有任何变化（说明 token 抽取没抽错）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 浏览页骨架与构建接线

侧边栏顶栏加入口按钮，已开着就激活而不是再开一个。
panel.css 的 token 与基础重置抽到 styles/tokens.css，两个页面共用。
权限门只申请 read，且必须由点击触发——页面加载时自动 requestPermission
会被浏览器忽略，用户只会看到一个卡住的空页面。"
```

---

### Task 2: ReadStore 与 Store 扩展

**Files:**
- Create: `src/core/read-store.ts`, `tests/core/read-store.test.ts`
- Modify: `src/core/store.ts`, `tests/helpers/memory-fs.ts`, `tests/core/store.test.ts`

**Interfaces:**
- Produces: `interface ReadStore { readText, readFile, exists, listEntries }`、`interface DirEntry { name: string; kind: 'file' | 'directory' }`、`toReadStore(s: ReadStore): ReadStore`。后续所有 `core/browse/*` 模块的第一个参数都是 `ReadStore`

- [ ] **Step 1: 确认运行环境有全局 File**

Run: `node -e "console.log(typeof File, typeof Blob)"`
Expected: `function function`

`File` 是 Node 20 起的全局对象。如果输出是 `undefined`，说明 Node 版本过低，先升级 Node 再继续——`memory-fs` 要靠它模拟 `getFile()`。

- [ ] **Step 2: 写失败的测试**

`tests/core/read-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { toReadStore } from '../../src/core/read-store';
import { memRoot } from '../helpers/memory-fs';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('listEntries', () => {
  it('区分文件与目录', async () => {
    await store.writeFile('d/a.json', 'x');
    await store.writeFile('d/sub/b.json', 'y');
    const entries = await store.listEntries('d');
    expect([...entries].sort((p, q) => p.name.localeCompare(q.name))).toEqual([
      { name: 'a.json', kind: 'file' },
      { name: 'sub', kind: 'directory' },
    ]);
  });

  it('目录不存在时返回空数组而非抛错', async () => {
    expect(await store.listEntries('missing')).toEqual([]);
  });

  it('列根目录', async () => {
    await store.writeFile('top/x.json', 'x');
    expect(await store.listEntries('')).toEqual([{ name: 'top', kind: 'directory' }]);
  });
});

describe('readFile', () => {
  it('读回二进制内容', async () => {
    await store.writeFile('bin/data.bin', new Uint8Array([1, 2, 3]));
    const f = await store.readFile('bin/data.bin');
    expect(f).not.toBeNull();
    expect(new Uint8Array(await f!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('文件不存在时返回 null', async () => {
    expect(await store.readFile('nope/none.bin')).toBeNull();
  });

  it('路径指向目录时返回 null', async () => {
    await store.writeFile('d/x.json', 'x');
    expect(await store.readFile('d')).toBeNull();
  });
});

describe('toReadStore', () => {
  it('只暴露四个读方法，写方法不可达', () => {
    const ro = toReadStore(store) as Record<string, unknown>;
    expect(Object.keys(ro).sort()).toEqual(['exists', 'listEntries', 'readFile', 'readText']);
    expect(ro.writeFile).toBeUndefined();
    expect(ro.removeDir).toBeUndefined();
  });

  it('转发读操作', async () => {
    await store.writeFile('a/b.json', 'hi');
    expect(await toReadStore(store).readText('a/b.json')).toBe('hi');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/core/read-store.test.ts`
Expected: FAIL —— 找不到模块 `src/core/read-store`

- [ ] **Step 4: 改造 memory-fs**

`tests/helpers/memory-fs.ts` 全文替换为：

```ts
/** FileSystemDirectoryHandle 的最小内存实现，只覆盖 store.ts 用到的 API。 */
class MemFile {
  kind = 'file' as const;
  constructor(public data: Uint8Array) {}
}

export class MemDir {
  /**
   * 名字不能叫 entries：真实 FSA 的 entries() 是个异步迭代器方法，
   * listEntries 要靠它拿 kind，字段与方法会撞名。
   */
  children = new Map<string, MemDir | MemFile>();
  kind = 'directory' as const;

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    const hit = this.children.get(name);
    if (hit instanceof MemDir) return hit;
    if (hit) throw new DOMException('is a file', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
    const d = new MemDir();
    this.children.set(name, d);
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const hit = this.children.get(name);
    if (!hit && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    if (hit instanceof MemDir) throw new DOMException('is a dir', 'TypeMismatchError');
    const self = this;
    if (!hit) self.children.set(name, new MemFile(new Uint8Array()));
    return {
      kind: 'file' as const,
      // 返回真实 File：store.readFile 直接把它交给调用方，
      // 自造的鸭子对象在类型和行为上都对不上。
      async getFile() {
        const f = self.children.get(name) as MemFile;
        return new File([f.data as BlobPart], name);
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
            self.children.set(name, new MemFile(merged));
          },
        };
      },
    };
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.children.has(name)) throw new DOMException('not found', 'NotFoundError');
    this.children.delete(name);
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of [...this.children.keys()]) yield k;
  }

  async *entries(): AsyncIterableIterator<[string, { kind: 'file' | 'directory' }]> {
    for (const [k, v] of [...this.children.entries()]) yield [k, { kind: v.kind }];
  }
}

export function memRoot(): FileSystemDirectoryHandle {
  return new MemDir() as unknown as FileSystemDirectoryHandle;
}
```

- [ ] **Step 5: 写 ReadStore**

`src/core/read-store.ts`：

```ts
export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

/**
 * 只读的存储视图。浏览页的所有模块都只认这个类型——
 * `queryPermission({mode:'read'})` 并不会把句柄降权，「只读」只能靠
 * 模块边界保证：类型里没有写方法，写操作就写不出来。
 */
export interface ReadStore {
  readText(path: string): Promise<string | null>;
  readFile(path: string): Promise<File | null>;
  exists(path: string): Promise<boolean>;
  listEntries(path: string): Promise<DirEntry[]>;
}

/** 从一个完整 Store 里摘出只读面。摘而不是直接传，是为了让写方法在运行时也不可达。 */
export function toReadStore(s: ReadStore): ReadStore {
  return {
    readText: (p) => s.readText(p),
    readFile: (p) => s.readFile(p),
    exists: (p) => s.exists(p),
    listEntries: (p) => s.listEntries(p),
  };
}
```

- [ ] **Step 6: 扩展 Store**

`src/core/store.ts` 顶部加 import，并把 `Store` 接口改为继承：

```ts
import type { DirEntry, ReadStore } from './read-store';

export interface Store extends ReadStore {
  writeFile(path: string, data: BlobPart): Promise<void>;
  listDir(path: string): Promise<string[]>;
  removeDir(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}
```

在 `createStore` 返回的对象里，`readText` 之后插入两个方法：

```ts
    async readFile(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return null;
      try {
        const fh = await dir.getFileHandle(name);
        return await fh.getFile();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async listEntries(path) {
      const dir = await dirOf(segments(path), false);
      if (!dir) return [];
      const out: DirEntry[] = [];
      for await (const [name, h] of dir.entries()) out.push({ name, kind: h.kind });
      return out;
    },
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/core/read-store.test.ts tests/core/store.test.ts`
Expected: PASS，两个文件全绿。`store.test.ts` 一行都不用改——`File` 同样有 `text()` 和 `size`。

- [ ] **Step 8: 跑全量回归**

Run: `npm test`
Expected: 全绿。memory-fs 是所有核心层测试的地基，字段改名后必须整体确认一遍。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ReadStore 接口与 Store 的二进制/条目读取

浏览页需要读图片二进制、需要分辨文件与目录，两者原来都没有。
Store 改为 extends ReadStore，浏览页只接 ReadStore——句柄本身仍是
readwrite，只读只能由类型边界保证。

memory-fs 的内部 Map 从 entries 改名为 children：真实 FSA 的 entries()
是异步迭代器方法，listEntries 要靠它拿 kind，字段与方法会撞名。
getFile() 改为返回真实 File，不再是自造的鸭子对象。"
```

---

### Task 3: 共享类型与目录树

**Files:**
- Create: `src/core/browse/types.ts`, `src/core/browse/tree.ts`, `tests/core/browse/tree.test.ts`

**Interfaces:**
- Consumes: `ReadStore`, `DirEntry`（Task 2）
- Produces: `NOTE_ID_RE`、`buildTree(store: ReadStore, onProgress?: (p: BuildProgress) => void): Promise<DatasetNode[]>`、`interface BuildProgress { done: number; current: string }`、`interface DatasetNode`（见下）

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/tree.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { buildTree } from '../../../src/core/browse/tree';
import { memRoot } from '../../helpers/memory-fs';

// 24 位小写 hex，与实测的真实 note id 同形态
const A = '6a61e639000000001c00e6d9';
const B = '6a6356e8000000002902e848';
const C = '6a636acb0000000029027397';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

/** 只有目录结构重要，内容随便写。 */
async function mkNote(path: string) {
  await store.writeFile(`${path}/note.json`, '{}');
  await store.writeFile(`${path}/images/01.jpg`, 'x');
}

describe('buildTree', () => {
  it('把含 note-ID 子目录的目录判为数据集叶子', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    await mkNote(`collected/2026-08-03/${B}`);
    const tree = await buildTree(store);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.path).toBe('collected');
    expect(tree[0]!.isDataset).toBe(false);
    expect(tree[0]!.count).toBe(2);
    const leaf = tree[0]!.children[0]!;
    expect(leaf.path).toBe('collected/2026-08-03');
    expect(leaf.isDataset).toBe(true);
    expect(leaf.noteIds).toEqual([A, B].sort());
  });

  it('笔记目录与脏目录混在同一层时，仍判为数据集并记下被忽略的目录', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    await store.writeFile('collected/2026-08-03/misc/readme.txt', 'x');
    const tree = await buildTree(store);
    const leaf = tree[0]!.children[0]!;
    expect(leaf.isDataset).toBe(true);
    expect(leaf.count).toBe(1);
    expect(leaf.ignoredDirs).toEqual(['misc']);
  });

  it('叶子不再向下递归，images 子目录不会变成子数据集', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    const tree = await buildTree(store);
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });

  it('排除 _index 与点开头的目录', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    await store.writeFile(`_index/6a/${A}/zach.json`, '{}');
    await store.writeFile('.git/HEAD', 'ref');
    const tree = await buildTree(store);
    expect(tree.map((n) => n.path)).toEqual(['collected']);
  });

  it('忽略顶层文件', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    await store.writeFile('README.md', '# x');
    await store.writeFile('.gitattributes', 'x');
    const tree = await buildTree(store);
    expect(tree.map((n) => n.path)).toEqual(['collected']);
  });

  it('没有任何后代数据集的中间目录不出现在树上', async () => {
    await store.writeFile('collected/2026-08-03/placeholder/x.txt', 'x');
    await mkNote(`archive/2026-07/${C}`);
    const tree = await buildTree(store);
    expect(tree.map((n) => n.path)).toEqual(['archive']);
  });

  it('支持任意深度的中间目录', async () => {
    await mkNote(`research/2026-q3/outfit/${A}`);
    const tree = await buildTree(store);
    expect(tree[0]!.path).toBe('research');
    expect(tree[0]!.children[0]!.path).toBe('research/2026-q3');
    const leaf = tree[0]!.children[0]!.children[0]!;
    expect(leaf.path).toBe('research/2026-q3/outfit');
    expect(leaf.isDataset).toBe(true);
  });

  it('中间节点的 count 是子树之和', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    await mkNote(`collected/2026-08-03/${B}`);
    await mkNote(`collected/2026-07-29/${C}`);
    const tree = await buildTree(store);
    expect(tree[0]!.count).toBe(3);
  });

  it('空仓库返回空数组', async () => {
    expect(await buildTree(store)).toEqual([]);
  });

  it('回报进度', async () => {
    await mkNote(`collected/2026-08-03/${A}`);
    const seen: string[] = [];
    await buildTree(store, (p) => seen.push(p.current));
    expect(seen).toContain('collected');
    expect(seen).toContain('collected/2026-08-03');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/tree.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/tree`

- [ ] **Step 3: 写共享类型**

`src/core/browse/types.ts`：

```ts
import type { ImageRecord, NoteRecord } from '../../types';

/** 一篇笔记在磁盘上的位置。noteId 单独不足以定位——竞态时同一篇会在多个目录。 */
export interface NoteRef {
  noteId: string;
  datasetPath: string;
}

/** `${datasetPath}/${noteId}`。所有与磁盘内容对应的缓存都用它做键。 */
export type NoteKey = string;

export interface DatasetNode {
  /** 相对 root 的路径，如 collected/2026-08-03 */
  path: string;
  /** 路径末段，显示用 */
  name: string;
  isDataset: boolean;
  /** 候选笔记目录数：只按名字形态数出来的，没读文件验证过 */
  count: number;
  /** 仅叶子有。建树时得到，选范围时直接复用，不再列第二遍目录 */
  noteIds: string[];
  /** 仅叶子有。同层里名字不像 note id 的目录，用于质量警告 */
  ignoredDirs: string[];
  children: DatasetNode[];
}

/** 列表、搜索、排序要的字段。 */
export interface RowMeta {
  noteId: string;
  datasetPath: string;
  title: string;
  content: string;
  tags: string[];
  authorNickname: string;
  liked: number;
  collected: number;
  comment: number;
  share: number;
  imageCount: number;
  /** 相对笔记目录，如 images/01.jpg。没有图片时为 null */
  coverFile: string | null;
  collector: string;
  firstArchivedAt: string;
  lastArchivedAt: string;
  archiveCount: number;
  publishedAt: string;
  lastEditedAt: string;
}

/** 详情栏要的字段。与 RowMeta 来自同一次 note.json 读取。 */
export interface NoteDetail {
  url: string;
  author: NoteRecord['author'];
  /** NoteRecord 没有顶层 IP 字段，只能从 raw.ipLocation 取。取完 raw 就丢 */
  ipLocation: string;
  images: ImageRecord[];
}

export type RowState =
  | { kind: 'pending' }
  | { kind: 'ready'; meta: RowMeta }
  | { kind: 'error'; reason: string };
```

- [ ] **Step 4: 写 buildTree**

`src/core/browse/tree.ts`：

```ts
import type { ReadStore } from '../read-store';
import type { DatasetNode } from './types';

/** 实测真实 note id 为 24 位小写 hex，放宽到 16~32 位以防将来变长。 */
export const NOTE_ID_RE = /^[0-9a-f]{16,32}$/;

/** 索引目录不是数据集，跳过。 */
const SKIP_TOP = new Set(['_index']);

export interface BuildProgress {
  done: number;
  current: string;
}

/**
 * 建整棵树。只列目录名，不读文件——但总工作量与笔记目录总数成正比，
 * 几万篇时会有可感知的耗时，所以带进度回调。
 *
 * 叶子的子目录名在 noteIds 里留着，选范围时直接复用，不再列第二遍。
 */
export async function buildTree(
  store: ReadStore,
  onProgress?: (p: BuildProgress) => void,
): Promise<DatasetNode[]> {
  let done = 0;

  async function subdirs(path: string): Promise<string[]> {
    const entries = await store.listEntries(path);
    return entries
      .filter((e) => e.kind === 'directory' && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  }

  async function visit(path: string, name: string): Promise<DatasetNode | null> {
    const names = await subdirs(path);
    onProgress?.({ done: ++done, current: path });

    const noteIds = names.filter((n) => NOTE_ID_RE.test(n));
    if (noteIds.length > 0) {
      // 只要有一个笔记目录就是数据集，同层的其他目录忽略并记一笔。
      // 「必须全都是笔记目录」那种判据会让混了一个 misc/ 的目录被当成中间层，
      // 遍历随后钻进笔记目录的 images/，整棵树就错了。
      return {
        path,
        name,
        isDataset: true,
        count: noteIds.length,
        noteIds,
        ignoredDirs: names.filter((n) => !NOTE_ID_RE.test(n)),
        children: [],
      };
    }

    const children: DatasetNode[] = [];
    for (const n of names) {
      const child = await visit(`${path}/${n}`, n);
      if (child) children.push(child);
    }
    // 没有任何后代数据集的中间目录不显示——空目录因此自动消失
    if (children.length === 0) return null;

    return {
      path,
      name,
      isDataset: false,
      count: children.reduce((a, c) => a + c.count, 0),
      noteIds: [],
      ignoredDirs: [],
      children,
    };
  }

  const out: DatasetNode[] = [];
  for (const n of (await subdirs('')).filter((n) => !SKIP_TOP.has(n))) {
    const node = await visit(n, n);
    if (node) out.push(node);
  }
  return out;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/tree.test.ts`
Expected: PASS，11 个用例全绿

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 数据集目录树

判据是「至少一个 note-ID 子目录即为数据集叶子，其余目录忽略并记警告，
叶子不再递归」。用「必须全都是笔记目录」会让混了一个 misc/ 的目录被判成
中间层，遍历钻进笔记的 images/，整棵树就错了。

叶子的 noteIds 留在节点上，选范围时直接复用，不列第二遍目录。"
```

---

### Task 4: 范围展开与排序比较器

**Files:**
- Create: `src/core/browse/scope.ts`, `tests/core/browse/scope.test.ts`

**Interfaces:**
- Consumes: `DatasetNode`, `NoteRef`, `NoteKey`, `RowMeta`（Task 3）
- Produces: `noteKeyOf(ref: NoteRef): NoteKey`、`collectRefs(nodes: DatasetNode[]): NoteRef[]`、`type SortKey`、`compareByDefault(a: NoteRef, b: NoteRef): number`、`compareByMeta(key: SortKey, a: RowMeta, b: RowMeta): number`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/scope.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { collectRefs, compareByDefault, compareByMeta, noteKeyOf } from '../../../src/core/browse/scope';
import type { DatasetNode, RowMeta } from '../../../src/core/browse/types';

const A = '6a61e639000000001c00e6d9';
const B = '6a6356e8000000002902e848';

function leaf(path: string, noteIds: string[]): DatasetNode {
  return {
    path, name: path.split('/').pop()!, isDataset: true,
    count: noteIds.length, noteIds, ignoredDirs: [], children: [],
  };
}

function meta(over: Partial<RowMeta>): RowMeta {
  return {
    noteId: A, datasetPath: 'collected/2026-08-03', title: '', content: '', tags: [],
    authorNickname: '', liked: 0, collected: 0, comment: 0, share: 0,
    imageCount: 0, coverFile: null, collector: '', firstArchivedAt: '',
    lastArchivedAt: '', archiveCount: 1, publishedAt: '', lastEditedAt: '',
    ...over,
  };
}

describe('noteKeyOf', () => {
  it('用物理路径做键，同一 noteId 在不同数据集下互不相同', () => {
    expect(noteKeyOf({ noteId: A, datasetPath: 'collected/2026-08-03' }))
      .toBe(`collected/2026-08-03/${A}`);
    expect(noteKeyOf({ noteId: A, datasetPath: 'collected/2026-08-03' }))
      .not.toBe(noteKeyOf({ noteId: A, datasetPath: 'collected/2026-07-29' }));
  });
});

describe('collectRefs', () => {
  it('展开单个叶子', () => {
    expect(collectRefs([leaf('collected/2026-08-03', [A, B])])).toEqual([
      { noteId: A, datasetPath: 'collected/2026-08-03' },
      { noteId: B, datasetPath: 'collected/2026-08-03' },
    ]);
  });

  it('展开中间节点下的全部叶子', () => {
    const mid: DatasetNode = {
      path: 'collected', name: 'collected', isDataset: false, count: 2,
      noteIds: [], ignoredDirs: [],
      children: [leaf('collected/2026-07-29', [B]), leaf('collected/2026-08-03', [A])],
    };
    expect(collectRefs([mid]).map(noteKeyOf)).toEqual([
      `collected/2026-07-29/${B}`,
      `collected/2026-08-03/${A}`,
    ]);
  });

  it('空树给空数组', () => {
    expect(collectRefs([])).toEqual([]);
  });
});

describe('compareByDefault', () => {
  it('数据集名倒序，组内按 noteId 升序', () => {
    const refs = [
      { noteId: B, datasetPath: 'collected/2026-07-29' },
      { noteId: B, datasetPath: 'collected/2026-08-03' },
      { noteId: A, datasetPath: 'collected/2026-08-03' },
    ];
    expect([...refs].sort(compareByDefault).map(noteKeyOf)).toEqual([
      `collected/2026-08-03/${A}`,
      `collected/2026-08-03/${B}`,
      `collected/2026-07-29/${B}`,
    ]);
  });
});

describe('compareByMeta', () => {
  it('数值字段升序', () => {
    expect(compareByMeta('liked', meta({ liked: 10 }), meta({ liked: 20 }))).toBeLessThan(0);
  });

  it('字符串字段用 localeCompare', () => {
    expect(compareByMeta('title', meta({ title: 'a' }), meta({ title: 'b' }))).toBeLessThan(0);
  });

  it('时间字段按 ISO 字符串比较', () => {
    const older = meta({ lastArchivedAt: '2026-08-03T11:20:00+08:00' });
    const newer = meta({ lastArchivedAt: '2026-08-03T14:02:00+08:00' });
    expect(compareByMeta('lastArchivedAt', older, newer)).toBeLessThan(0);
  });

  it('相等时回落到 noteId，保证排序稳定', () => {
    const x = meta({ noteId: A, liked: 5 });
    const y = meta({ noteId: B, liked: 5 });
    expect(compareByMeta('liked', x, y)).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/scope.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/scope`

- [ ] **Step 3: 写实现**

`src/core/browse/scope.ts`：

```ts
import type { DatasetNode, NoteKey, NoteRef, RowMeta } from './types';

export function noteKeyOf(ref: NoteRef): NoteKey {
  return `${ref.datasetPath}/${ref.noteId}`;
}

/** 展开树节点得到范围内全部笔记。复用建树时留下的 noteIds，不再列目录。 */
export function collectRefs(nodes: DatasetNode[]): NoteRef[] {
  const out: NoteRef[] = [];
  const walk = (n: DatasetNode) => {
    if (n.isDataset) {
      for (const id of n.noteIds) out.push({ noteId: id, datasetPath: n.path });
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

/**
 * 默认序：数据集名倒序、组内按目录名升序。
 * 日期形态的目录名天然就是时间倒序，因此不读任何文件就能定出一个有意义的序。
 */
export function compareByDefault(a: NoteRef, b: NoteRef): number {
  if (a.datasetPath !== b.datasetPath) return a.datasetPath < b.datasetPath ? 1 : -1;
  return a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0;
}

export type SortKey =
  | 'title' | 'authorNickname'
  | 'liked' | 'collected' | 'comment' | 'share'
  | 'imageCount' | 'archiveCount'
  | 'publishedAt' | 'lastEditedAt' | 'firstArchivedAt' | 'lastArchivedAt'
  | 'collector';

/** 升序。降序由调用方取反——把方向塞进比较器会让稳定性回落也跟着反过来。 */
export function compareByMeta(key: SortKey, a: RowMeta, b: RowMeta): number {
  const x = a[key];
  const y = b[key];
  let r = 0;
  if (typeof x === 'number' && typeof y === 'number') r = x - y;
  else r = String(x).localeCompare(String(y));
  // 相等时回落到 noteId：否则同值行在每次重排后位置乱跳
  return r !== 0 ? r : a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 范围展开与排序比较器

NoteKey 用物理路径而非 noteId：竞态时同一篇存在于多个数据集目录，
用 noteId 做键会让两行互相覆盖对方的路径、采集者与图片。

比较器只做升序，方向由调用方取反——把方向塞进比较器会让相等时
回落到 noteId 的那一步也跟着反过来，排序就不稳定了。"
```

---

### Task 5: 笔记元数据与详情加载

**Files:**
- Create: `src/core/browse/row-meta.ts`, `tests/core/browse/row-meta.test.ts`

**Interfaces:**
- Consumes: `ReadStore`（Task 2）、`NoteRef` `RowMeta` `NoteDetail`（Task 3）、`noteKeyOf`（Task 4）
- Produces: `type LoadNoteResult = { ok: true; meta: RowMeta; detail: NoteDetail } | { ok: false; reason: string }`、`loadNote(store: ReadStore, ref: NoteRef): Promise<LoadNoteResult>`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/row-meta.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { loadNote } from '../../../src/core/browse/row-meta';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

function noteJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: 1,
    note_id: A,
    url: `https://www.xiaohongshu.com/explore/${A}`,
    type: 'normal',
    title: '夏日通勤穿搭',
    content: '三件单品搞定一周',
    tags: ['穿搭', '通勤'],
    published_at: '2026-08-01T09:12:00+08:00',
    last_edited_at: '2026-08-02T20:30:00+08:00',
    author: { user_id: 'u1', nickname: '小 A', avatar_url: 'https://x/a.jpg', profile_url: 'https://x/u1' },
    interact: { liked: 1236, collected: 402, comment: 96, share: 31 },
    images: [
      { index: 1, file: 'images/01.jpg', is_live: false, file_id: 'f1', width: 1080, height: 1440,
        declared_width: 1080, declared_height: 1440, bytes: 100, sha256: 'a', source_kind: 'original', source_url: 'https://x/1' },
      { index: 2, file: 'images/02.webp', is_live: false, file_id: 'f2', width: 1080, height: 1440,
        declared_width: 1080, declared_height: 1440, bytes: 100, sha256: 'b', source_kind: 'WB_DFT', source_url: 'https://x/2' },
    ],
    archive: {
      first_archived_at: '2026-08-03T14:02:11+08:00',
      last_archived_at: '2026-08-03T14:02:11+08:00',
      collector: 'zach',
      archive_count: 2,
      status: 'complete',
    },
    raw: { noteId: A, ipLocation: '上海', desc: '很长的原文', imageList: [] },
    ...over,
  });
}

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('loadNote', () => {
  it('一次读取同时产出 RowMeta 与 NoteDetail', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.title).toBe('夏日通勤穿搭');
    expect(r.meta.authorNickname).toBe('小 A');
    expect(r.meta.liked).toBe(1236);
    expect(r.meta.collected).toBe(402);
    expect(r.meta.comment).toBe(96);
    expect(r.meta.share).toBe(31);
    expect(r.meta.imageCount).toBe(2);
    expect(r.meta.coverFile).toBe('images/01.jpg');
    expect(r.meta.collector).toBe('zach');
    expect(r.meta.archiveCount).toBe(2);
    expect(r.meta.datasetPath).toBe(DS);
    expect(r.detail.images).toHaveLength(2);
    expect(r.detail.author.nickname).toBe('小 A');
  });

  it('IP 从 raw.ipLocation 提取，raw 本身不保留', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok && r.detail.ipLocation).toBe('上海');
    expect(r.ok && (r.detail as Record<string, unknown>).raw).toBeUndefined();
    expect(r.ok && (r.meta as Record<string, unknown>).raw).toBeUndefined();
  });

  it('文件不存在时给出可读原因', async () => {
    const r = await loadNote(store, ref);
    expect(r).toEqual({ ok: false, reason: 'note.json 不存在' });
  });

  it('JSON 损坏时不抛错', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, '{ 坏掉的');
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('解析失败');
  });

  it('缺必要字段时判为错误行', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, JSON.stringify({ note_id: A }));
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('缺少必要字段');
  });

  it('没有图片时 coverFile 为 null', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ images: [] }));
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.coverFile).toBeNull();
    expect(r.ok && r.meta.imageCount).toBe(0);
  });

  it('缺 raw.ipLocation 时给空串而不是崩', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ raw: { noteId: A } }));
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    expect(r.ok && r.detail.ipLocation).toBe('');
  });

  it('同一 noteId 在两个数据集下各自独立', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ title: '这份在 08-03' }));
    await store.writeFile(`collected/2026-07-29/${A}/note.json`, noteJson({ title: '这份在 07-29' }));
    const x = await loadNote(store, ref);
    const y = await loadNote(store, { noteId: A, datasetPath: 'collected/2026-07-29' });
    expect(x.ok && x.meta.title).toBe('这份在 08-03');
    expect(y.ok && y.meta.title).toBe('这份在 07-29');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/row-meta.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/row-meta`

- [ ] **Step 3: 写实现**

`src/core/browse/row-meta.ts`：

```ts
import type { NoteRecord } from '../../types';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteRef, RowMeta } from './types';

export type LoadNoteResult =
  | { ok: true; meta: RowMeta; detail: NoteDetail }
  | { ok: false; reason: string };

/**
 * 一次读取同时产出列表要的 RowMeta 和详情要的 NoteDetail。
 * 分两次读会让打开详情栏又走一遍磁盘，而多出来的只是一个 images 数组。
 *
 * 两者都不带 raw：它是 note.json 里最大的一块，只为归档 diff 稳定性存在，
 * 浏览页只用得上里面的 ipLocation 一个值。
 */
export async function loadNote(store: ReadStore, ref: NoteRef): Promise<LoadNoteResult> {
  const txt = await store.readText(`${noteKeyOf(ref)}/note.json`);
  if (txt === null) return { ok: false, reason: 'note.json 不存在' };

  let j: NoteRecord;
  try {
    j = JSON.parse(txt) as NoteRecord;
  } catch (e) {
    return { ok: false, reason: `note.json 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }

  if (typeof j.note_id !== 'string' || !Array.isArray(j.images) || typeof j.archive !== 'object' || j.archive === null) {
    return { ok: false, reason: 'note.json 缺少必要字段（note_id / images / archive）' };
  }

  const raw = j.raw as { ipLocation?: unknown } | undefined;

  return {
    ok: true,
    meta: {
      noteId: j.note_id,
      datasetPath: ref.datasetPath,
      title: j.title ?? '',
      content: j.content ?? '',
      tags: j.tags ?? [],
      authorNickname: j.author?.nickname ?? '',
      liked: j.interact?.liked ?? 0,
      collected: j.interact?.collected ?? 0,
      comment: j.interact?.comment ?? 0,
      share: j.interact?.share ?? 0,
      imageCount: j.images.length,
      coverFile: j.images[0]?.file ?? null,
      collector: j.archive.collector ?? '',
      firstArchivedAt: j.archive.first_archived_at ?? '',
      lastArchivedAt: j.archive.last_archived_at ?? '',
      archiveCount: j.archive.archive_count ?? 0,
      publishedAt: j.published_at ?? '',
      lastEditedAt: j.last_edited_at ?? '',
    },
    detail: {
      url: j.url ?? '',
      author: j.author,
      ipLocation: typeof raw?.ipLocation === 'string' ? raw.ipLocation : '',
      images: j.images,
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/row-meta.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 笔记元数据与详情加载

一次 note.json 读取同时产出 RowMeta 与 NoteDetail：分两次读会让打开
详情栏又走一遍磁盘，而多出来的只是一个 images 数组。

两者都不留 raw，只从中取 ipLocation——NoteRecord 没有顶层 IP 字段，
而整份 raw 是 note.json 里最大的一块。"
```

---

### Task 6: 评论加载

**Files:**
- Create: `src/core/browse/comments.ts`, `tests/core/browse/comments.test.ts`

**Interfaces:**
- Consumes: `ReadStore`、`NoteRef`、`noteKeyOf`
- Produces: `type CommentsResult = { kind: 'none' } | { kind: 'ok'; file: CommentsFile } | { kind: 'error'; reason: string }`、`loadComments(store: ReadStore, ref: NoteRef): Promise<CommentsResult>`、`commentImagePath(ref: NoteRef, file: string): string`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/comments.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { commentImagePath, loadComments } from '../../../src/core/browse/comments';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

const FILE = JSON.stringify({
  schema_version: 1,
  note_id: A,
  declared_total: 96,
  collected_count: 18,
  complete: false,
  has_more: true,
  comments: [
    {
      id: '6a61e88a00000000090162b7',
      content: '这套配色好会挑',
      published_at: '2026-08-01T10:00:00+08:00',
      ip_location: '上海',
      liked_count: 12,
      author: { user_id: 'u2', nickname: '小 D', avatar_url: '', profile_url: '' },
      at_users: [],
      tags: [],
      images: [{ index: 1, file: 'images/comments/6a61e88a00000000090162b7-01.webp',
        width: 556, height: 717, declared_width: 284, declared_height: 367,
        bytes: 1, sha256: 'x', source_kind: 'WB_DFT', source_url: 'https://x/c1' }],
      sub_comment_count: 1,
      sub_comments: [{
        id: '6a636acb0000000029027397',
        content: '谢谢喜欢～',
        published_at: '2026-08-01T10:05:00+08:00',
        ip_location: '上海',
        liked_count: 0,
        author: { user_id: 'u1', nickname: '小 A', avatar_url: '', profile_url: '' },
        at_users: [], tags: [], images: [],
      }],
    },
  ],
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('loadComments', () => {
  it('读出完整结构，含子评论与配图', async () => {
    await store.writeFile(`${DS}/${A}/comments.json`, FILE);
    const r = await loadComments(store, ref);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.file.declared_total).toBe(96);
    expect(r.file.collected_count).toBe(18);
    expect(r.file.comments[0]!.sub_comments![0]!.content).toBe('谢谢喜欢～');
    expect(r.file.comments[0]!.images[0]!.file).toContain('images/comments/');
  });

  it('文件不存在是正常状态 none，不是错误', async () => {
    expect(await loadComments(store, ref)).toEqual({ kind: 'none' });
  });

  it('JSON 损坏时报 error 而不是 none', async () => {
    await store.writeFile(`${DS}/${A}/comments.json`, '{ 坏');
    const r = await loadComments(store, ref);
    expect(r.kind).toBe('error');
  });
});

describe('commentImagePath', () => {
  it('拼成相对仓库根的完整路径', () => {
    expect(commentImagePath(ref, 'images/comments/x-01.webp'))
      .toBe(`${DS}/${A}/images/comments/x-01.webp`);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/comments.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/comments`

- [ ] **Step 3: 写实现**

`src/core/browse/comments.ts`：

```ts
import type { CommentsFile } from '../../types';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteRef } from './types';

export type CommentsResult =
  | { kind: 'none' }
  | { kind: 'ok'; file: CommentsFile }
  | { kind: 'error'; reason: string };

/**
 * 文件不存在返回 none 而不是 error：没采评论是正常状态
 * （采集时页面上一条都没加载出来就不会写这个文件），报成错误会吓人。
 */
export async function loadComments(store: ReadStore, ref: NoteRef): Promise<CommentsResult> {
  const txt = await store.readText(`${noteKeyOf(ref)}/comments.json`);
  if (txt === null) return { kind: 'none' };
  try {
    const file = JSON.parse(txt) as CommentsFile;
    if (!Array.isArray(file.comments)) return { kind: 'error', reason: 'comments.json 缺少 comments 数组' };
    return { kind: 'ok', file };
  } catch (e) {
    return { kind: 'error', reason: `comments.json 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** CommentImageRecord.file 是相对笔记目录的，读盘要补上笔记目录前缀。 */
export function commentImagePath(ref: NoteRef, file: string): string {
  return `${noteKeyOf(ref)}/${file}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/comments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 评论加载

文件不存在返回 none 而不是 error：采集时页面上一条评论都没加载出来
就不会写这个文件，那是正常状态，报成错误会吓人。"
```

---

### Task 7: 数据质量判定

**Files:**
- Create: `src/core/browse/quality.ts`, `tests/core/browse/quality.test.ts`

**Interfaces:**
- Consumes: `ReadStore`、`NoteRef` `NoteDetail`、`noteKeyOf`、`pointerDir` from `src/core/index-store.ts`、`Pointer` from `src/types.ts`
- Produces: `type QualityState`（六种）、`interface QualityReport { state: QualityState; missingImages: string[]; pointers: Pointer[] }`、`checkQuality(store: ReadStore, ref: NoteRef, detail: NoteDetail | null): Promise<QualityReport>`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/quality.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { checkQuality } from '../../../src/core/browse/quality';
import type { NoteDetail } from '../../../src/core/browse/types';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

function detailWith(files: string[]): NoteDetail {
  return {
    url: '', ipLocation: '',
    author: { user_id: 'u1', nickname: '小 A', avatar_url: '', profile_url: '' },
    images: files.map((file, i) => ({
      index: i + 1, file, is_live: false, file_id: `f${i}`,
      width: 1, height: 1, declared_width: 1, declared_height: 1,
      bytes: 1, sha256: 'x', source_kind: 'original' as const, source_url: '',
    })),
  };
}

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

async function writePointer(collector: string, path: string) {
  await store.writeFile(
    `_index/6a/${A}/${collector}.json`,
    JSON.stringify({ note_id: A, path, collector, title: 't',
      first_archived_at: '2026-08-03T14:02:11+08:00', last_archived_at: '2026-08-03T14:02:11+08:00' }),
  );
}

describe('checkQuality', () => {
  it('指针唯一且指向当前目录、图片齐全 → ok', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'ok' });
    expect(r.missingImages).toEqual([]);
  });

  it('没有任何指针 → no_pointer', async () => {
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('no_pointer');
  });

  it('有指针但指向别的目录 → pointer_elsewhere', async () => {
    await writePointer('zach', `collected/2026-07-29/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'pointer_elsewhere', paths: [`collected/2026-07-29/${A}`] });
  });

  it('多个指针指向不同目录 → race_diverged', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `collected/2026-07-29/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('race_diverged');
  });

  it('多人指针指向同一个当前目录 → race_same_path', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'race_same_path', collectors: ['lily', 'zach'] });
  });

  it('指针指向当前目录但图片缺失 → invariant_broken，且盖过 race_same_path', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `${DS}/${A}`);
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg', 'images/02.webp']));
    expect(r.state).toEqual({ kind: 'invariant_broken', missing: ['images/01.jpg', 'images/02.webp'] });
  });

  it('note.json 读不出但指针指向当前目录 → invariant_broken', async () => {
    await writePointer('zach', `${DS}/${A}`);
    const r = await checkQuality(store, ref, null);
    expect(r.state).toEqual({ kind: 'invariant_broken', missing: ['note.json'] });
  });

  it('没有指针时图片缺失只记 missingImages，不升级为不变量破裂', async () => {
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('no_pointer');
    expect(r.missingImages).toEqual(['images/01.jpg']);
  });

  it('损坏的指针文件不让整个判定失败', async () => {
    await store.writeFile(`_index/6a/${A}/broken.json`, '{ 坏');
    await writePointer('zach', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'ok' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/quality.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/quality`

- [ ] **Step 3: 写实现**

`src/core/browse/quality.ts`：

```ts
import type { Pointer } from '../../types';
import { pointerDir } from '../index-store';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteRef } from './types';

export type QualityState =
  | { kind: 'ok' }
  | { kind: 'no_pointer' }
  | { kind: 'pointer_elsewhere'; paths: string[] }
  | { kind: 'race_diverged'; pointers: Pointer[] }
  | { kind: 'race_same_path'; collectors: string[] }
  | { kind: 'invariant_broken'; missing: string[] };

export interface QualityReport {
  state: QualityState;
  /** 无论指针状态如何都报，供画廊标出缺哪几张 */
  missingImages: string[];
  pointers: Pointer[];
}

/**
 * index-store.lookup 要的是完整 Store（它用 listDir），浏览页只有 ReadStore。
 * 这里用 listEntries 重读一遍，代价是十来行重复，换来浏览页彻底不碰写接口。
 */
async function readPointers(store: ReadStore, noteId: string): Promise<Pointer[]> {
  const dir = pointerDir(noteId);
  const out: Pointer[] = [];
  for (const e of await store.listEntries(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const txt = await store.readText(`${dir}/${e.name}`);
    if (txt === null) continue;
    try {
      out.push(JSON.parse(txt) as Pointer);
    } catch {
      // 损坏的指针不该让整篇的质量判定失败
    }
  }
  return out;
}

async function missingImageFiles(
  store: ReadStore,
  ref: NoteRef,
  detail: NoteDetail,
): Promise<string[]> {
  const base = noteKeyOf(ref);
  const missing: string[] = [];
  for (const img of detail.images) {
    if (!(await store.exists(`${base}/${img.file}`))) missing.push(img.file);
  }
  return missing;
}

/**
 * 判据必须比对物理路径。只看「指针存不存在」会把一种情况判错：
 * 同一 note_id 有指针、但指向另一个目录，那时当前这个目录仍然是孤儿。
 *
 * detail 传 null 表示 note.json 根本读不出来。
 */
export async function checkQuality(
  store: ReadStore,
  ref: NoteRef,
  detail: NoteDetail | null,
): Promise<QualityReport> {
  const here = noteKeyOf(ref);
  const pointers = await readPointers(store, ref.noteId);
  const missingImages = detail ? await missingImageFiles(store, ref, detail) : [];

  const atHere = pointers.filter((p) => p.path === here);
  const paths = [...new Set(pointers.map((p) => p.path))].sort();

  let state: QualityState;
  if (pointers.length === 0) {
    state = { kind: 'no_pointer' };
  } else if (atHere.length === 0) {
    state = { kind: 'pointer_elsewhere', paths };
  } else if (detail === null) {
    state = { kind: 'invariant_broken', missing: ['note.json'] };
  } else if (missingImages.length > 0) {
    // 有指针却数据不全，说明「指针存在 ⟹ 数据完整」这条不变量已经破了。
    // 它比路径分叉更要紧：别人的查重结果因此是错的。
    state = { kind: 'invariant_broken', missing: missingImages };
  } else if (paths.length > 1) {
    state = { kind: 'race_diverged', pointers };
  } else if (atHere.length > 1) {
    state = { kind: 'race_same_path', collectors: atHere.map((p) => p.collector).sort() };
  } else {
    state = { kind: 'ok' };
  }

  return { state, missingImages, pointers };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/quality.test.ts`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 数据质量判定

判据比对 pointer.path 与当前物理路径，不是只看指针存不存在——同一
note_id 可能有指针但指向另一个目录，那时当前目录仍是孤儿。

有指针却数据不全排在路径分叉之前：它意味着「指针存在 ⟹ 数据完整」
这条不变量破了，别人的查重结果因此是错的。

不复用 index-store.lookup，因为它要完整 Store；这里用 listEntries
重读一遍，十来行重复换浏览页彻底不碰写接口。"
```

---

### Task 8: 搜索与排序

**Files:**
- Create: `src/core/browse/search.ts`, `tests/core/browse/search.test.ts`

**Interfaces:**
- Consumes: `NoteRef` `NoteKey` `RowMeta`、`noteKeyOf` `compareByDefault` `compareByMeta` `SortKey`
- Produces: `matches(meta: RowMeta, query: string): boolean`、`type Sort = { key: SortKey | 'default'; desc: boolean }`、`sortRefs(refs: NoteRef[], metas: Map<NoteKey, RowMeta>, sort: Sort): NoteRef[]`、`filterRefs(refs, metas, opts: { query: string; collector: string | null }): NoteRef[]`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/search.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { filterRefs, matches, sortRefs } from '../../../src/core/browse/search';
import { noteKeyOf } from '../../../src/core/browse/scope';
import type { NoteKey, NoteRef, RowMeta } from '../../../src/core/browse/types';

const A = '6a61e639000000001c00e6d9';
const B = '6a6356e8000000002902e848';
const DS = 'collected/2026-08-03';

function meta(over: Partial<RowMeta>): RowMeta {
  return {
    noteId: A, datasetPath: DS, title: '', content: '', tags: [], authorNickname: '',
    liked: 0, collected: 0, comment: 0, share: 0, imageCount: 0, coverFile: null,
    collector: 'zach', firstArchivedAt: '', lastArchivedAt: '', archiveCount: 1,
    publishedAt: '', lastEditedAt: '', ...over,
  };
}

function table(...entries: [NoteRef, RowMeta][]): Map<NoteKey, RowMeta> {
  return new Map(entries.map(([r, m]) => [noteKeyOf(r), m]));
}

const refA: NoteRef = { noteId: A, datasetPath: DS };
const refB: NoteRef = { noteId: B, datasetPath: DS };

describe('matches', () => {
  it('空查询全部命中', () => {
    expect(matches(meta({}), '')).toBe(true);
    expect(matches(meta({}), '   ')).toBe(true);
  });

  it('命中标题、正文、作者、标签', () => {
    expect(matches(meta({ title: '夏日通勤穿搭' }), '通勤')).toBe(true);
    expect(matches(meta({ content: '三件单品搞定一周' }), '单品')).toBe(true);
    expect(matches(meta({ authorNickname: '小 A' }), '小')).toBe(true);
    expect(matches(meta({ tags: ['穿搭', '通勤'] }), '穿搭')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(matches(meta({ title: 'Summer OOTD' }), 'ootd')).toBe(true);
  });

  it('都不命中就返回 false', () => {
    expect(matches(meta({ title: '咖啡' }), '穿搭')).toBe(false);
  });
});

describe('filterRefs', () => {
  it('按查询词过滤', () => {
    const metas = table([refA, meta({ noteId: A, title: '穿搭' })], [refB, meta({ noteId: B, title: '咖啡' })]);
    expect(filterRefs([refA, refB], metas, { query: '穿搭', collector: null })).toEqual([refA]);
  });

  it('按采集者过滤', () => {
    const metas = table([refA, meta({ noteId: A, collector: 'zach' })], [refB, meta({ noteId: B, collector: 'lily' })]);
    expect(filterRefs([refA, refB], metas, { query: '', collector: 'lily' })).toEqual([refB]);
  });

  it('元数据还没加载的行在有筛选条件时被排除', () => {
    expect(filterRefs([refA], new Map(), { query: '穿搭', collector: null })).toEqual([]);
  });

  it('没有任何筛选条件时保留未加载的行', () => {
    expect(filterRefs([refA], new Map(), { query: '', collector: null })).toEqual([refA]);
  });
});

describe('sortRefs', () => {
  it('default 走目录序，不需要元数据', () => {
    const refs = [
      { noteId: B, datasetPath: 'collected/2026-07-29' },
      { noteId: A, datasetPath: 'collected/2026-08-03' },
    ];
    expect(sortRefs(refs, new Map(), { key: 'default', desc: false }).map(noteKeyOf)).toEqual([
      `collected/2026-08-03/${A}`,
      `collected/2026-07-29/${B}`,
    ]);
  });

  it('按字段升序与降序', () => {
    const metas = table([refA, meta({ noteId: A, liked: 10 })], [refB, meta({ noteId: B, liked: 20 })]);
    expect(sortRefs([refA, refB], metas, { key: 'liked', desc: false })).toEqual([refA, refB]);
    expect(sortRefs([refA, refB], metas, { key: 'liked', desc: true })).toEqual([refB, refA]);
  });

  it('缺元数据的行沉到末尾，不因排序消失', () => {
    const metas = table([refA, meta({ noteId: A, liked: 10 })]);
    expect(sortRefs([refB, refA], metas, { key: 'liked', desc: false })).toEqual([refA, refB]);
  });

  it('不修改传入的数组', () => {
    const refs = [refB, refA];
    sortRefs(refs, new Map(), { key: 'default', desc: false });
    expect(refs).toEqual([refB, refA]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/search.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/search`

- [ ] **Step 3: 写实现**

`src/core/browse/search.ts`：

```ts
import { compareByDefault, compareByMeta, noteKeyOf, type SortKey } from './scope';
import type { NoteKey, NoteRef, RowMeta } from './types';

/** 不分词、不模糊。团队内部核对用的工具，子串匹配够了。 */
export function matches(meta: RowMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    meta.title.toLowerCase().includes(q) ||
    meta.content.toLowerCase().includes(q) ||
    meta.authorNickname.toLowerCase().includes(q) ||
    meta.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export interface FilterOpts {
  query: string;
  collector: string | null;
}

/**
 * 有筛选条件时，元数据还没加载的行一律排除——「不知道它匹不匹配」不能
 * 当成「它匹配」。调用方应先扫描（scanScope）再筛，扫完就不会有未加载的行。
 */
export function filterRefs(
  refs: NoteRef[],
  metas: Map<NoteKey, RowMeta>,
  opts: FilterOpts,
): NoteRef[] {
  const active = opts.query.trim() !== '' || opts.collector !== null;
  if (!active) return refs;
  return refs.filter((r) => {
    const m = metas.get(noteKeyOf(r));
    if (!m) return false;
    if (opts.collector !== null && m.collector !== opts.collector) return false;
    return matches(m, opts.query);
  });
}

export interface Sort {
  key: SortKey | 'default';
  desc: boolean;
}

export function sortRefs(refs: NoteRef[], metas: Map<NoteKey, RowMeta>, sort: Sort): NoteRef[] {
  const out = [...refs];
  if (sort.key === 'default') {
    out.sort(compareByDefault);
    return sort.desc ? out.reverse() : out;
  }
  const key = sort.key;
  out.sort((a, b) => {
    const ma = metas.get(noteKeyOf(a));
    const mb = metas.get(noteKeyOf(b));
    // 缺元数据的沉到末尾。丢掉它们会让行凭空消失，比排得不准糟得多
    if (!ma && !mb) return compareByDefault(a, b);
    if (!ma) return 1;
    if (!mb) return -1;
    const r = compareByMeta(key, ma, mb);
    return sort.desc ? -r : r;
  });
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 内存内搜索与排序

有筛选条件时未加载元数据的行一律排除——「不知道它匹不匹配」不能当成
「它匹配」。但排序时它们沉到末尾而不是被丢掉：让行凭空消失比排得不准糟。"
```

---

### Task 9: 虚拟滚动可见区间

**Files:**
- Create: `src/core/browse/virtual.ts`, `tests/core/browse/virtual.test.ts`

**Interfaces:**
- Produces: `interface VisibleRange { start: number; end: number }`（左闭右开）、`visibleRange(scrollTop: number, viewportHeight: number, rowHeight: number, total: number, overscan: number): VisibleRange`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/virtual.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { visibleRange } from '../../../src/core/browse/virtual';

describe('visibleRange', () => {
  it('顶部：从 0 开始，末尾多算一行加 overscan', () => {
    // 视口 440px / 行高 44px = 10 行，+1 行补半行，+2 overscan
    expect(visibleRange(0, 440, 44, 1000, 2)).toEqual({ start: 0, end: 13 });
  });

  it('滚到中间', () => {
    expect(visibleRange(440, 440, 44, 1000, 2)).toEqual({ start: 8, end: 23 });
  });

  it('滚到底部时 end 被总数夹住', () => {
    expect(visibleRange(44 * 990, 440, 44, 1000, 2)).toEqual({ start: 988, end: 1000 });
  });

  it('总数为 0 时返回空区间', () => {
    expect(visibleRange(0, 440, 44, 0, 8)).toEqual({ start: 0, end: 0 });
  });

  it('容器还没测量出高度时返回空区间', () => {
    expect(visibleRange(0, 0, 44, 1000, 8)).toEqual({ start: 0, end: 0 });
  });

  it('行高为 0 时不除零', () => {
    expect(visibleRange(0, 440, 0, 1000, 8)).toEqual({ start: 0, end: 0 });
  });

  it('橡皮筋回弹造成的负 scrollTop 不会算出负下标', () => {
    expect(visibleRange(-120, 440, 44, 1000, 2)).toEqual({ start: 0, end: 13 });
  });

  it('总数少于一屏时全部返回', () => {
    expect(visibleRange(0, 440, 44, 3, 8)).toEqual({ start: 0, end: 3 });
  });

  it('overscan 为 0 时正好覆盖可见行', () => {
    expect(visibleRange(0, 440, 44, 1000, 0)).toEqual({ start: 0, end: 11 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/virtual.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/virtual`

- [ ] **Step 3: 写实现**

`src/core/browse/virtual.ts`：

```ts
/** 左闭右开。 */
export interface VisibleRange {
  start: number;
  end: number;
}

/**
 * 算该渲染哪几行。做成纯函数是因为虚拟滚动出错几乎全在边界上：
 * 首尾、总数为 0、容器高度还没测出来、橡皮筋回弹的负 scrollTop。
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): VisibleRange {
  if (total <= 0 || rowHeight <= 0 || viewportHeight <= 0) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  // +1 是给顶部露出半行的情况补一行，否则滚动时底部会闪空白
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, first + visible + overscan),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/virtual.test.ts`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 虚拟滚动可见区间

做成纯函数是因为虚拟滚动出错几乎全在边界上：首尾、总数为 0、
容器高度还没测出来、橡皮筋回弹的负 scrollTop。"
```

---

### Task 10: LRU 缓存

**Files:**
- Create: `src/core/browse/lru.ts`, `tests/core/browse/lru.test.ts`

**Interfaces:**
- Produces: `class Lru<V>`，方法 `get(key: string): V | undefined`、`set(key: string, value: V): void`、`has(key: string): boolean`、`clear(): void`、getter `size`。构造参数 `{ max: number; onEvict(value: V): void }`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/lru.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { Lru } from '../../../src/core/browse/lru';

function tracked(max: number) {
  const evicted: string[] = [];
  const lru = new Lru<string>({ max, onEvict: (v) => evicted.push(v) });
  return { lru, evicted };
}

describe('Lru', () => {
  it('存取', () => {
    const { lru } = tracked(3);
    lru.set('a', 'A');
    expect(lru.get('a')).toBe('A');
    expect(lru.get('missing')).toBeUndefined();
    expect(lru.has('a')).toBe(true);
  });

  it('超出上限时淘汰最久未使用的一项并回调', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.set('c', 'C');
    expect(evicted).toEqual(['A']);
    expect(lru.has('a')).toBe(false);
    expect(lru.size).toBe(2);
  });

  it('读一下就变成最近使用，淘汰的是另一个', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.get('a');
    lru.set('c', 'C');
    expect(evicted).toEqual(['B']);
    expect(lru.has('a')).toBe(true);
  });

  it('覆盖同一个键时释放旧值', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A1');
    lru.set('a', 'A2');
    expect(evicted).toEqual(['A1']);
    expect(lru.get('a')).toBe('A2');
    expect(lru.size).toBe(1);
  });

  it('clear 释放全部', () => {
    const { lru, evicted } = tracked(3);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.clear();
    expect(evicted.sort()).toEqual(['A', 'B']);
    expect(lru.size).toBe(0);
  });

  it('max 为 1 时每次 set 都淘汰上一个', () => {
    const { lru, evicted } = tracked(1);
    lru.set('a', 'A');
    lru.set('b', 'B');
    expect(evicted).toEqual(['A']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/lru.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/lru`

- [ ] **Step 3: 写实现**

`src/core/browse/lru.ts`：

```ts
export interface LruOptions<V> {
  max: number;
  /** 值被淘汰、覆盖或清空时调用。缩略图缓存在这里 revokeObjectURL。 */
  onEvict(value: V): void;
}

/**
 * 靠 Map 的插入序实现：删掉再插入即为「最近使用」。
 * 不依赖任何浏览器 API，因此内存行为可以在 Node 下直接测——
 * 而它恰好是整个浏览页最主要的内存风险来源。
 */
export class Lru<V> {
  private map = new Map<string, V>();

  constructor(private opts: LruOptions<V>) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      this.opts.onEvict(old);
    }
    this.map.set(key, value);
    while (this.map.size > this.opts.max) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      const victim = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
      this.opts.onEvict(victim);
    }
  }

  clear(): void {
    for (const v of this.map.values()) this.opts.onEvict(v);
    this.map.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/lru.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 带淘汰回调的 LRU

不依赖任何浏览器 API，所以内存行为能在 Node 下直接测——而它恰好是
整个浏览页最主要的内存风险来源，靠「滚几千行看内存」验不稳。"
```

---

### Task 11: 并发队列

**Files:**
- Create: `src/core/browse/queue.ts`, `tests/core/browse/queue.test.ts`

**Interfaces:**
- Produces: `type TaskOutcome<T> = { kind: 'done'; value: T } | { kind: 'dropped' } | { kind: 'stale'; value: T } | { kind: 'failed'; error: unknown }`、`class TaskQueue`，方法 `push<T>(task: () => Promise<T>, isCancelled: () => boolean, onSettle: (o: TaskOutcome<T>) => void): void`、`clearPending(): void`、getter `pendingCount` / `runningCount`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/queue.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { TaskQueue, type TaskOutcome } from '../../../src/core/browse/queue';

/** 手动控制何时完成的任务。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const never = () => false;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('TaskQueue', () => {
  it('同时运行的任务不超过上限', async () => {
    const q = new TaskQueue(2);
    const d = [deferred<number>(), deferred<number>(), deferred<number>()];
    d.forEach((x, i) => q.push(() => x.promise, never, () => { void i; }));
    await flush();
    expect(q.runningCount).toBe(2);
    expect(q.pendingCount).toBe(1);
    d[0]!.resolve(0);
    await flush();
    expect(q.runningCount).toBe(2);
    expect(q.pendingCount).toBe(0);
  });

  it('正常完成回 done', async () => {
    const q = new TaskQueue(1);
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => 'x', never, (o) => seen.push(o));
    await flush();
    expect(seen).toEqual([{ kind: 'done', value: 'x' }]);
  });

  it('排队期间被取消的任务根本不启动', async () => {
    const q = new TaskQueue(1);
    const blocker = deferred<number>();
    q.push(() => blocker.promise, never, () => {});
    let started = false;
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => { started = true; return 'x'; }, () => true, (o) => seen.push(o));
    blocker.resolve(0);
    await flush();
    expect(started).toBe(false);
    expect(seen).toEqual([{ kind: 'dropped' }]);
  });

  it('启动后才取消的任务，结果标为 stale 并把值交回去释放', async () => {
    const q = new TaskQueue(1);
    let cancelled = false;
    const d = deferred<string>();
    const seen: TaskOutcome<string>[] = [];
    q.push(() => d.promise, () => cancelled, (o) => seen.push(o));
    await flush();
    cancelled = true;              // 读已经开始了，中止不了，只能事后忽略
    d.resolve('已经读出来的东西');
    await flush();
    expect(seen).toEqual([{ kind: 'stale', value: '已经读出来的东西' }]);
  });

  it('任务抛错回 failed，且不卡住后续任务', async () => {
    const q = new TaskQueue(1);
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => { throw new Error('读盘失败'); }, never, (o) => seen.push(o));
    q.push(async () => 'ok', never, (o) => seen.push(o));
    await flush();
    expect(seen[0]!.kind).toBe('failed');
    expect(seen[1]).toEqual({ kind: 'done', value: 'ok' });
  });

  it('clearPending 丢掉排队中的任务并报 dropped，不影响正在跑的', async () => {
    const q = new TaskQueue(1);
    const blocker = deferred<number>();
    const seen: TaskOutcome<string>[] = [];
    q.push(() => blocker.promise, never, () => {});
    q.push(async () => 'x', never, (o) => seen.push(o));
    q.clearPending();
    expect(q.pendingCount).toBe(0);
    expect(seen).toEqual([{ kind: 'dropped' }]);
    blocker.resolve(0);
    await flush();
    expect(q.runningCount).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/queue.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/queue`

- [ ] **Step 3: 写实现**

`src/core/browse/queue.ts`：

```ts
export type TaskOutcome<T> =
  | { kind: 'done'; value: T }
  /** 还没启动就被取消，没花任何代价 */
  | { kind: 'dropped' }
  /** 已经启动，中止不了；值交回调用方去释放 */
  | { kind: 'stale'; value: T }
  | { kind: 'failed'; error: unknown };

interface Job {
  run(): void;
  drop(): void;
}

/**
 * 并发上限队列。快速拖滚动条时会瞬间排起几百个读取请求，不设限会把
 * 磁盘和内存同时打满。
 *
 * 两种取消要分开处理：还没启动的直接丢掉；已经启动的中止不了，只能等它
 * 完成后把值交回去让调用方立刻释放——objectURL 不释放就是内存泄漏。
 */
export class TaskQueue {
  private running = 0;
  private queue: Job[] = [];

  constructor(private limit: number) {}

  get runningCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  push<T>(
    task: () => Promise<T>,
    isCancelled: () => boolean,
    onSettle: (o: TaskOutcome<T>) => void,
  ): void {
    this.queue.push({
      run: () => {
        if (isCancelled()) {
          onSettle({ kind: 'dropped' });
          this.done();
          return;
        }
        void task().then(
          (value) => {
            onSettle(isCancelled() ? { kind: 'stale', value } : { kind: 'done', value });
            this.done();
          },
          (error: unknown) => {
            onSettle({ kind: 'failed', error });
            this.done();
          },
        );
      },
      drop: () => onSettle({ kind: 'dropped' }),
    });
    this.pump();
  }

  /** 切换范围时调用：排队中的任务已经没人要了。 */
  clearPending(): void {
    const dropped = this.queue;
    this.queue = [];
    for (const j of dropped) j.drop();
  }

  private done(): void {
    this.running--;
    this.pump();
  }

  private pump(): void {
    while (this.running < this.limit && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      job.run();
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/queue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 并发上限队列

两种取消分开处理：还没启动的直接丢掉；已经启动的中止不了，只能等它
完成后把值交回调用方立刻释放——objectURL 不释放就是内存泄漏。"
```

---

### Task 12: 范围扫描（进度与取消）

**Files:**
- Create: `src/core/browse/scan.ts`, `tests/core/browse/scan.test.ts`

**Interfaces:**
- Consumes: `ReadStore`、`NoteRef` `NoteKey` `RowMeta` `NoteDetail`、`noteKeyOf`、`loadNote`
- Produces: `interface ScanResult { loaded: number; skipped: number; failures: { ref: NoteRef; reason: string }[]; completed: boolean }`、`scanScope(store, refs, sink, opts): Promise<ScanResult>`，其中 `sink: { metas: Map<NoteKey, RowMeta>; details: Map<NoteKey, NoteDetail>; errors: Map<NoteKey, string> }`，`opts: { signal?: AbortSignal; onProgress?(done: number, total: number): void }`

- [ ] **Step 1: 写失败的测试**

`tests/core/browse/scan.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { scanScope } from '../../../src/core/browse/scan';
import { noteKeyOf } from '../../../src/core/browse/scope';
import type { NoteDetail, NoteKey, NoteRef, RowMeta } from '../../../src/core/browse/types';
import { memRoot } from '../../helpers/memory-fs';

const DS = 'collected/2026-08-03';
const ids = [
  '6a61e639000000001c00e6d9',
  '6a6356e8000000002902e848',
  '6a636acb0000000029027397',
];
const refs: NoteRef[] = ids.map((noteId) => ({ noteId, datasetPath: DS }));

function noteJson(id: string, title: string) {
  return JSON.stringify({
    schema_version: 1, note_id: id, url: '', type: 'normal', title, content: '', tags: [],
    published_at: '', last_edited_at: '',
    author: { user_id: 'u', nickname: 'n', avatar_url: '', profile_url: '' },
    interact: { liked: 0, collected: 0, comment: 0, share: 0 },
    images: [],
    archive: { first_archived_at: '', last_archived_at: '', collector: 'zach', archive_count: 1, status: 'complete' },
    raw: {},
  });
}

function sink() {
  return {
    metas: new Map<NoteKey, RowMeta>(),
    details: new Map<NoteKey, NoteDetail>(),
    errors: new Map<NoteKey, string>(),
  };
}

let store: Store;
beforeEach(async () => {
  store = createStore(memRoot());
  for (const [i, id] of ids.entries()) {
    await store.writeFile(`${DS}/${id}/note.json`, noteJson(id, `第 ${i} 篇`));
  }
});

describe('scanScope', () => {
  it('把范围内全部元数据填进 sink', async () => {
    const s = sink();
    const r = await scanScope(store, refs, s, {});
    expect(r).toEqual({ loaded: 3, skipped: 0, failures: [], completed: true });
    expect(s.metas.size).toBe(3);
    expect(s.details.size).toBe(3);
    expect(s.metas.get(noteKeyOf(refs[0]!))!.title).toBe('第 0 篇');
  });

  it('已经加载过的跳过，不重读', async () => {
    const s = sink();
    await scanScope(store, refs, s, {});
    const r = await scanScope(store, refs, s, {});
    expect(r).toEqual({ loaded: 0, skipped: 3, failures: [], completed: true });
  });

  it('回报进度', async () => {
    const seen: [number, number][] = [];
    await scanScope(store, refs, sink(), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('单篇失败不中断，汇总在 failures 里', async () => {
    await store.writeFile(`${DS}/${ids[1]}/note.json`, '{ 坏');
    const s = sink();
    const r = await scanScope(store, refs, s, {});
    expect(r.loaded).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.ref.noteId).toBe(ids[1]);
    expect(r.completed).toBe(true);
    expect(s.errors.get(noteKeyOf(refs[1]!))).toContain('解析失败');
  });

  it('取消后 completed 为 false，但已读到的保留', async () => {
    const ctrl = new AbortController();
    const s = sink();
    const r = await scanScope(store, refs, s, {
      signal: ctrl.signal,
      onProgress: (done) => { if (done === 1) ctrl.abort(); },
    });
    expect(r.completed).toBe(false);
    expect(r.loaded).toBe(1);
    expect(s.metas.size).toBe(1);
  });

  it('已经取消的 signal 传进来就一篇都不读', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await scanScope(store, refs, sink(), { signal: ctrl.signal });
    expect(r).toEqual({ loaded: 0, skipped: 0, failures: [], completed: false });
  });

  it('空范围直接完成', async () => {
    expect(await scanScope(store, [], sink(), {}))
      .toEqual({ loaded: 0, skipped: 0, failures: [], completed: true });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/core/browse/scan.test.ts`
Expected: FAIL —— 找不到模块 `src/core/browse/scan`

- [ ] **Step 3: 写实现**

`src/core/browse/scan.ts`：

```ts
import type { ReadStore } from '../read-store';
import { loadNote } from './row-meta';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteKey, NoteRef, RowMeta } from './types';

export interface ScanSink {
  metas: Map<NoteKey, RowMeta>;
  details: Map<NoteKey, NoteDetail>;
  errors: Map<NoteKey, string>;
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface ScanResult {
  loaded: number;
  skipped: number;
  failures: { ref: NoteRef; reason: string }[];
  /** false 表示中途取消。调用方据此决定不给这个范围打 scanned 标记 */
  completed: boolean;
}

/**
 * 把整个范围的元数据读满。排序、搜索、按采集者筛选都要全量数据，
 * 做不到懒加载，所以做成带进度和取消的显式动作。
 *
 * 取消后已读到的保留在 sink 里（下次扫描会跳过），但 completed 为 false ——
 * 调用方不能拿半份数据去排序或搜索，那会让用户看到一个没有说明的子集。
 */
export async function scanScope(
  store: ReadStore,
  refs: NoteRef[],
  sink: ScanSink,
  opts: ScanOptions,
): Promise<ScanResult> {
  const failures: ScanResult['failures'] = [];
  let loaded = 0;
  let skipped = 0;
  let done = 0;

  for (const ref of refs) {
    if (opts.signal?.aborted === true) {
      return { loaded, skipped, failures, completed: false };
    }
    const key = noteKeyOf(ref);
    if (sink.metas.has(key) || sink.errors.has(key)) {
      skipped++;
      opts.onProgress?.(++done, refs.length);
      continue;
    }
    const r = await loadNote(store, ref);
    if (r.ok) {
      sink.metas.set(key, r.meta);
      sink.details.set(key, r.detail);
      loaded++;
    } else {
      sink.errors.set(key, r.reason);
      failures.push({ ref, reason: r.reason });
    }
    opts.onProgress?.(++done, refs.length);
  }

  return { loaded, skipped, failures, completed: true };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/core/browse/scan.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量核心层测试**

Run: `npm test`
Expected: 全绿。核心层到此完整，后面都是 UI。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 范围扫描，带进度与取消

取消后已读到的元数据保留（下次扫描跳过），但 completed 为 false：
调用方不能拿半份数据去排序或搜索，那会让用户看到一个没有说明的子集。"
```

---

### Task 13: 目录树与范围选择

从这里开始是 UI。**这些任务没有单元测试**——项目的 vitest 是 `environment: 'node'`，没装 jsdom 也没装 testing-library，而全部可测逻辑已经在核心层测过了（这正是那样切分的目的）。验收方式是 `npm run build` + 在 Chrome 里按步骤看。

**Files:**
- Create: `src/browser/hooks/useScope.ts`, `src/browser/components/Tree.tsx`
- Modify: `src/browser/App.tsx`, `src/browser/browser.css`

**Interfaces:**
- Consumes: `buildTree` `BuildProgress`（Task 3）、`collectRefs`（Task 4）、`toReadStore`（Task 2）
- Produces: `useScope(store: ReadStore | null)` 返回 `{ tree, refs, selected, select, progress, reload }`

- [ ] **Step 1: 写 useScope**

`src/browser/hooks/useScope.ts`：

```ts
import { useCallback, useEffect, useState } from 'react';
import { buildTree, type BuildProgress } from '../../core/browse/tree';
import { collectRefs } from '../../core/browse/scope';
import type { DatasetNode, NoteRef } from '../../core/browse/types';
import type { ReadStore } from '../../core/read-store';

/** null 表示「全部」。 */
export type Selection = string | null;

function findNode(nodes: DatasetNode[], path: string): DatasetNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = findNode(n.children, path);
    if (hit) return hit;
  }
  return null;
}

export function useScope(store: ReadStore | null) {
  const [tree, setTree] = useState<DatasetNode[]>([]);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [refs, setRefs] = useState<NoteRef[]>([]);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!store) return;
    let alive = true;
    setProgress({ done: 0, current: '' });
    void (async () => {
      const t = await buildTree(store, (p) => { if (alive) setProgress(p); });
      if (!alive) return;
      setTree(t);
      setProgress(null);
    })();
    return () => { alive = false; };
  }, [store, gen]);

  // 树或选择变了就重算范围。collectRefs 只走内存里的 noteIds，不碰磁盘
  useEffect(() => {
    const nodes = selected === null ? tree : [findNode(tree, selected)].filter((n) => n !== null);
    setRefs(collectRefs(nodes));
  }, [tree, selected]);

  const reload = useCallback(() => setGen((g) => g + 1), []);

  return { tree, refs, selected, select: setSelected, progress, reload };
}
```

- [ ] **Step 2: 写 Tree 组件**

`src/browser/components/Tree.tsx`：

```tsx
import { useState } from 'react';
import type { DatasetNode } from '../../core/browse/types';
import type { Selection } from '../hooks/useScope';

function Node({
  node, depth, selected, onSelect,
}: {
  node: DatasetNode; depth: number; selected: Selection; onSelect(p: Selection): void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className={`bw-node${selected === node.path ? ' on' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onSelect(node.path)}
      >
        <span
          className={`bw-twist${hasChildren ? '' : ' hidden'}${open ? ' open' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          ▸
        </span>
        <span className="bw-node-name" title={node.path}>{node.name}</span>
        <span className="bw-node-count">{node.count}</span>
      </div>
      {open && node.children.map((c) => (
        <Node key={c.path} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}

export function Tree({
  tree, total, selected, onSelect,
}: {
  tree: DatasetNode[]; total: number; selected: Selection; onSelect(p: Selection): void;
}) {
  return (
    <nav className="bw-tree">
      <div
        className={`bw-node${selected === null ? ' on' : ''}`}
        style={{ paddingLeft: 8 }}
        onClick={() => onSelect(null)}
      >
        <span className="bw-twist hidden">▸</span>
        <span className="bw-node-name">全部</span>
        <span className="bw-node-count">{total}</span>
      </div>
      {tree.map((n) => (
        <Node key={n.path} node={n} depth={0} selected={selected} onSelect={onSelect} />
      ))}
      {tree.length === 0 && <p className="bw-empty">还没有采集过笔记</p>}
    </nav>
  );
}
```

- [ ] **Step 3: 接进 App**

`src/browser/App.tsx` 全文替换：

```tsx
import { useCallback, useMemo, useState } from 'react';
import { toReadStore, type ReadStore } from '../core/read-store';
import type { Store } from '../core/store';
import { PermissionGate } from './components/PermissionGate';
import { Tree } from './components/Tree';
import { useScope } from './hooks/useScope';

export function App() {
  const [store, setStore] = useState<ReadStore | null>(null);
  const [rootName, setRootName] = useState('');

  // 只把只读面往下传。传完整 Store 的话，「浏览页不写盘」就只剩口头承诺
  const onReady = useCallback((s: Store, name: string) => {
    setStore(toReadStore(s));
    setRootName(name);
  }, []);

  const { tree, refs, selected, select, progress, reload } = useScope(store);
  const total = useMemo(() => tree.reduce((a, n) => a + n.count, 0), [tree]);

  return (
    <div className="bw">
      <PermissionGate onReady={onReady}>
        <header className="bw-top">
          <span className="bw-brand"><span className="dot" />数据集浏览</span>
          <span className="bw-root">{rootName}</span>
          <span className="bw-crumb">{selected ?? '全部'} · {refs.length} 篇</span>
          <span className="bw-spacer" />
          {progress && <span className="bw-progress">正在读取目录 {progress.done} · {progress.current}</span>}
          <button className="bw-btn" onClick={reload}>重新加载</button>
        </header>
        <div className="bw-main">
          <Tree tree={tree} total={total} selected={selected} onSelect={select} />
          <div className="bw-list">
            <p className="bw-empty">列表在下一个任务里接上（当前范围 {refs.length} 篇）</p>
          </div>
        </div>
      </PermissionGate>
    </div>
  );
}
```

- [ ] **Step 4: 补样式**

在 `src/browser/browser.css` 末尾追加：

```css
/* ── 顶栏 ─────────────────────────────────────────────── */
.bw-top {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--surface);
}
.bw-brand { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.bw-brand .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.bw-root, .bw-crumb, .bw-progress { color: var(--ink-3); font-size: 12px; }
.bw-spacer { flex: 1; }
.bw-btn {
  padding: 4px 10px; border: 1px solid var(--line-2); border-radius: 7px;
  background: var(--surface); color: var(--ink-2); font-size: 12px;
}
.bw-btn:hover { background: var(--sunk); color: var(--ink); }

/* ── 主体三栏 ─────────────────────────────────────────── */
.bw-main { flex: 1 1 auto; min-height: 0; display: flex; }

.bw-tree {
  flex: none; width: 220px; overflow-y: auto; padding: 8px 0;
  border-right: 1px solid var(--line); background: var(--paper);
}
.bw-node {
  display: flex; align-items: center; gap: 4px; padding: 3px 8px 3px 0;
  cursor: default; font-size: 12px; color: var(--ink-2); white-space: nowrap;
}
.bw-node:hover { background: var(--sunk); }
.bw-node.on { background: var(--accent-w); color: var(--ink); }
.bw-twist {
  flex: none; width: 12px; text-align: center; color: var(--ink-3);
  transition: transform .12s; font-size: 9px;
}
.bw-twist.open { transform: rotate(90deg); }
.bw-twist.hidden { visibility: hidden; }
.bw-node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.bw-node-count { flex: none; color: var(--ink-3); font-variant-numeric: tabular-nums; }

.bw-list { flex: 1 1 auto; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
.bw-empty { color: var(--ink-3); padding: 16px; }
```

- [ ] **Step 5: 构建并验收**

Run: `npm run build`
Expected: 构建成功

在 Chrome 里重新加载扩展，打开浏览页，确认：

1. 左侧出现目录树，`全部` 的数字等于各数据集之和
2. 建树期间顶栏出现「正在读取目录 N · 路径」，建完消失
3. 点某个数据集，面包屑变成它的路径与篇数
4. 点三角能折叠展开，点节点本身只选中不折叠
5. 空仓库（换一个空目录测）显示「还没有采集过笔记」
6. 点「重新加载」会重建树（可先在文件管理器里新建一个数据集目录，点完能看到它出现）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 浏览页目录树与范围选择

树只列目录名，不读文件；叶子的 noteIds 在建树时就留下了，选范围时
直接复用，不再列第二遍目录。

App 只往下传 toReadStore 的产物：传完整 Store 的话，「浏览页不写盘」
就只剩口头承诺。"
```

---

### Task 14: 表格列表、懒读与缩略图

**Files:**
- Create: `src/browser/hooks/useThumbnail.ts`, `src/browser/hooks/useRows.ts`, `src/browser/components/Table.tsx`
- Modify: `src/browser/App.tsx`, `src/browser/browser.css`

**Interfaces:**
- Consumes: `visibleRange`（Task 9）、`Lru`（Task 10）、`TaskQueue`（Task 11）、`loadNote`（Task 5）、`noteKeyOf`（Task 4）
- Produces: `useRows(store, refs)` 返回 `{ rows: Map<NoteKey, RowState>, details: Map<NoteKey, NoteDetail>, request(ref: NoteRef): void, sink }`；`useThumbnail(store)` 返回 `{ thumbUrl(ref, file, size): string | undefined, releaseAll(): void }`

- [ ] **Step 1: 写缩略图 hook**

`src/browser/hooks/useThumbnail.ts`：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lru } from '../../core/browse/lru';
import { TaskQueue } from '../../core/browse/queue';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { ReadStore } from '../../core/read-store';

const THUMB_MAX = 300;
/** 原图几 MB 一张，和缩略图共用一张 300 条的表会一直占着内存不放 */
const FULL_MAX = 3;
const CONCURRENCY = 6;

export type ThumbSize = 96 | 320 | 'full';

/**
 * 缩到目标宽度后立刻丢掉原始 blob。原图 2~5 MB，解码后占内存十几倍，
 * 不缩就撑不过几屏。
 */
async function decode(file: File, size: ThumbSize): Promise<string> {
  if (size === 'full') return URL.createObjectURL(file);
  const bmp = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'low' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }));
}

export function useThumbnail(store: ReadStore | null) {
  // tick 只用来触发重渲染：缓存本身在 ref 里，不能进 state（每帧新对象会打爆渲染）
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const thumbs = useMemo(
    () => new Lru<string>({ max: THUMB_MAX, onEvict: (u) => URL.revokeObjectURL(u) }),
    [],
  );
  const fulls = useMemo(
    () => new Lru<string>({ max: FULL_MAX, onEvict: (u) => URL.revokeObjectURL(u) }),
    [],
  );
  const queue = useMemo(() => new TaskQueue(CONCURRENCY), []);
  const inflight = useRef(new Set<string>());
  const wanted = useRef(new Set<string>());

  const releaseAll = useCallback(() => {
    queue.clearPending();
    thumbs.clear();
    fulls.clear();
    wanted.current.clear();
  }, [queue, thumbs, fulls]);

  useEffect(() => releaseAll, [releaseAll]);

  const thumbUrl = useCallback(
    (ref: NoteRef, file: string, size: ThumbSize): string | undefined => {
      const key = `${noteKeyOf(ref)}::${file}::${size}`;
      const table = size === 'full' ? fulls : thumbs;
      const hit = table.get(key);
      if (hit !== undefined) return hit;
      if (inflight.current.has(key) || store === null) return undefined;

      inflight.current.add(key);
      wanted.current.add(key);
      queue.push(
        async () => {
          const f = await store.readFile(`${noteKeyOf(ref)}/${file}`);
          return f === null ? null : await decode(f, size);
        },
        () => !wanted.current.has(key),
        (o) => {
          inflight.current.delete(key);
          if (o.kind === 'stale' && o.value !== null) {
            // 读已经开始了，中止不了；拿到手立刻释放，否则就是泄漏
            URL.revokeObjectURL(o.value);
            return;
          }
          if (o.kind === 'done' && o.value !== null) {
            table.set(key, o.value);
            bump();
          }
        },
      );
      return undefined;
    },
    [store, queue, thumbs, fulls, bump],
  );

  /** 滚出视口就别做了。已经开始的读取会在完成时按 stale 释放掉 */
  const forget = useCallback((ref: NoteRef, file: string, size: ThumbSize) => {
    wanted.current.delete(`${noteKeyOf(ref)}::${file}::${size}`);
  }, []);

  return { thumbUrl, forget, releaseAll };
}
```

- [ ] **Step 2: 写行加载 hook**

`src/browser/hooks/useRows.ts`：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadNote } from '../../core/browse/row-meta';
import { noteKeyOf } from '../../core/browse/scope';
import type { ScanSink } from '../../core/browse/scan';
import type { NoteKey, NoteRef, RowState } from '../../core/browse/types';
import type { ReadStore } from '../../core/read-store';

export function useRows(store: ReadStore | null, refs: NoteRef[]) {
  const [version, setVersion] = useState(0);
  const sink = useRef<ScanSink>({ metas: new Map(), details: new Map(), errors: new Map() });
  const inflight = useRef(new Set<NoteKey>());

  // 换范围就清空：元数据键是物理路径，跨范围本来可以复用，但保留会让
  // 「重新加载」失去意义——用户点它就是想看磁盘上的新状态
  useEffect(() => {
    sink.current = { metas: new Map(), details: new Map(), errors: new Map() };
    inflight.current.clear();
    setVersion((v) => v + 1);
  }, [refs]);

  const request = useCallback(
    (ref: NoteRef) => {
      if (store === null) return;
      const key = noteKeyOf(ref);
      const s = sink.current;
      if (s.metas.has(key) || s.errors.has(key) || inflight.current.has(key)) return;
      inflight.current.add(key);
      void loadNote(store, ref).then((r) => {
        inflight.current.delete(key);
        if (r.ok) {
          s.metas.set(key, r.meta);
          s.details.set(key, r.detail);
        } else {
          s.errors.set(key, r.reason);
        }
        setVersion((v) => v + 1);
      });
    },
    [store],
  );

  const stateOf = useCallback(
    (ref: NoteRef): RowState => {
      const key = noteKeyOf(ref);
      const meta = sink.current.metas.get(key);
      if (meta) return { kind: 'ready', meta };
      const err = sink.current.errors.get(key);
      if (err !== undefined) return { kind: 'error', reason: err };
      return { kind: 'pending' };
    },
    // version 变了要重算，故意列进依赖
    [version],
  );

  return useMemo(() => ({ sink: sink.current, request, stateOf, version }), [request, stateOf, version]);
}
```

- [ ] **Step 3: 写 Table 组件**

`src/browser/components/Table.tsx`：

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef, RowState } from '../../core/browse/types';
import { visibleRange } from '../../core/browse/virtual';
import type { ThumbSize } from '../hooks/useThumbnail';

export const ROW_H = 44;
const OVERSCAN = 8;
const THUMB: ThumbSize = 96;

function num(n: number): string {
  return n.toLocaleString('zh-CN');
}

function Cover({ url }: { url: string | undefined }) {
  return <span className="bw-cover">{url ? <img src={url} alt="" /> : null}</span>;
}

export function Table({
  refs, stateOf, request, thumbUrl, forget, wide, selectedKey, onSelect,
}: {
  refs: NoteRef[];
  stateOf(ref: NoteRef): RowState;
  request(ref: NoteRef): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
  forget(ref: NoteRef, file: string, size: ThumbSize): void;
  wide: boolean;
  selectedKey: string | null;
  onSelect(ref: NoteRef): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const shown = useRef<NoteRef[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const { start, end } = visibleRange(scrollTop, height, ROW_H, refs.length, OVERSCAN);
  const slice = refs.slice(start, end);

  // 进视口就读元数据；滚出去的告诉缩略图层别做了
  useEffect(() => {
    for (const r of slice) request(r);
    const now = new Set(slice.map(noteKeyOf));
    for (const old of shown.current) {
      if (now.has(noteKeyOf(old))) continue;
      const st = stateOf(old);
      if (st.kind === 'ready' && st.meta.coverFile) forget(old, st.meta.coverFile, THUMB);
    }
    shown.current = slice;
  });

  return (
    <div className="bw-table">
      <div className={`bw-head${wide ? ' wide' : ''}`}>
        <span className="c-cover" />
        <span className="c-title">标题</span>
        <span className="c-author">作者</span>
        <span className="c-num">赞</span>
        <span className="c-num">藏</span>
        <span className="c-num">评</span>
        {wide && <span className="c-num">享</span>}
        {wide && <span className="c-num">图片</span>}
        {wide && <span className="c-author">采集者</span>}
        <span className="c-time">采集时间</span>
        {wide && <span className="c-path">落盘路径</span>}
      </div>

      <div className="bw-scroll" ref={box} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: refs.length * ROW_H, position: 'relative' }}>
          {slice.map((ref, i) => {
            const key = noteKeyOf(ref);
            const st = stateOf(ref);
            const top = (start + i) * ROW_H;
            const cls = `bw-row${wide ? ' wide' : ''}${selectedKey === key ? ' on' : ''}`;

            if (st.kind === 'error') {
              return (
                <div key={key} className={`${cls} err`} style={{ top }} onClick={() => onSelect(ref)}>
                  <span className="c-cover" />
                  <span className="c-title">读取失败：{st.reason}</span>
                  <span className="c-path">{key}</span>
                </div>
              );
            }
            if (st.kind === 'pending') {
              return (
                <div key={key} className={`${cls} dim`} style={{ top }}>
                  <span className="c-cover" />
                  <span className="c-title">…</span>
                </div>
              );
            }

            const m = st.meta;
            return (
              <div key={key} className={cls} style={{ top }} onClick={() => onSelect(ref)}>
                <Cover url={m.coverFile ? thumbUrl(ref, m.coverFile, THUMB) : undefined} />
                <span className="c-title" title={m.title}>{m.title || '（无标题）'}</span>
                <span className="c-author" title={m.authorNickname}>{m.authorNickname}</span>
                <span className="c-num">{num(m.liked)}</span>
                <span className="c-num">{num(m.collected)}</span>
                <span className="c-num">{num(m.comment)}</span>
                {wide && <span className="c-num">{num(m.share)}</span>}
                {wide && <span className="c-num">{m.imageCount}</span>}
                {wide && <span className="c-author">{m.collector}</span>}
                <span className="c-time">{m.lastArchivedAt.slice(5, 16).replace('T', ' ')}</span>
                {wide && <span className="c-path" title={m.datasetPath}>{m.datasetPath}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bw-foot">↑↓ 换行 · Enter 开详情 · Esc 关详情 · 共 {refs.length} 篇</div>
    </div>
  );
}
```

- [ ] **Step 4: 接进 App**

`src/browser/App.tsx` 里，在 `useScope` 之后加上：

```tsx
  const { stateOf, request } = useRows(store, refs);
  const { thumbUrl, forget } = useThumbnail(store);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
```

对应 import：

```tsx
import { useRows } from './hooks/useRows';
import { useThumbnail } from './hooks/useThumbnail';
import { Table } from './components/Table';
import { noteKeyOf } from '../core/browse/scope';
```

把 `<div className="bw-list">…</div>` 整块换成：

```tsx
          <div className="bw-list">
            <Table
              refs={refs}
              stateOf={stateOf}
              request={request}
              thumbUrl={thumbUrl}
              forget={forget}
              wide
              selectedKey={selectedKey}
              onSelect={(r) => setSelectedKey(noteKeyOf(r))}
            />
          </div>
```

- [ ] **Step 5: 补样式**

在 `src/browser/browser.css` 末尾追加：

```css
/* ── 表格 ─────────────────────────────────────────────── */
.bw-table { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }

.bw-head, .bw-row {
  display: flex; align-items: center; gap: 8px; padding: 0 10px;
  font-variant-numeric: tabular-nums;
}
.bw-head {
  flex: none; height: 30px; font-size: 11px; color: var(--ink-3);
  border-bottom: 1px solid var(--line); background: var(--surface);
}
.bw-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.bw-row {
  position: absolute; left: 0; right: 0; height: 44px;
  border-bottom: 1px solid var(--line); font-size: 12px; color: var(--ink-2);
}
.bw-row:hover { background: var(--sunk); }
.bw-row.on { background: var(--accent-w); color: var(--ink); }
.bw-row.dim { color: var(--ink-3); }
.bw-row.err { color: var(--accent); }

.bw-cover {
  flex: none; width: 30px; height: 30px; border-radius: 4px;
  background: var(--sunk); overflow: hidden; display: block;
}
.bw-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.c-cover { flex: none; width: 30px; }
.c-title { flex: 2 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.c-author { flex: none; width: 64px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-num { flex: none; width: 52px; text-align: right; }
.c-time { flex: none; width: 88px; }
.c-path { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-3); }

.bw-foot {
  flex: none; padding: 5px 10px; font-size: 11px; color: var(--ink-3);
  border-top: 1px solid var(--line); background: var(--surface);
}
```

- [ ] **Step 6: 构建并验收**

Run: `npm run build`
Expected: 构建成功

在 Chrome 里确认（需要仓库里已有几十篇以上，不够就先多采几篇）：

1. 列表显示标题、作者、赞/藏/评、采集时间，数字右对齐
2. 缩略图逐个出现，不是一次全出——说明是懒读
3. 快速拖滚动条到底再拖回来，不卡死；DevTools → Memory 里 JS heap 不持续上涨
4. 打开 DevTools → Network 之外看不出请求，但在 Performance 里录一段快速滚动，主线程没有长时间阻塞
5. 手动破坏一篇：把某个笔记目录的 `note.json` 改成 `{ 坏`，重新加载后那一行显示红色「读取失败」，其他行正常
6. 把某个笔记目录的 `images/01.jpg` 删掉，那行缩略图显示为空占位，行本身正常

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: 表格列表、行懒读与缩略图

行滚进视口才读 note.json；缩略图缩到 96px 后原始 blob 立刻丢弃，
objectURL 走 LRU 并在淘汰时 revoke。

滚出视口的读取任务分两种处理：还没启动的丢掉，已经启动的在完成时
按 stale 立刻释放——中止不了，但不能不释放。"
```

---

### Task 15: 详情栏与看图器

**Files:**
- Create: `src/browser/components/DetailPane.tsx`, `src/browser/components/Lightbox.tsx`
- Modify: `src/browser/App.tsx`, `src/browser/browser.css`

**Interfaces:**
- Consumes: `loadComments` `commentImagePath`（Task 6）、`checkQuality` `QualityState`（Task 7）、`useThumbnail`（Task 14）
- Produces: `<DetailPane ref detail meta store onClose onWidth />`、`<Lightbox ref images index onIndex onClose thumbUrl />`

- [ ] **Step 1: 写看图器**

`src/browser/components/Lightbox.tsx`：

```tsx
import { useEffect } from 'react';
import type { ImageRecord } from '../../types';
import type { NoteRef } from '../../core/browse/types';
import type { ThumbSize } from '../hooks/useThumbnail';

export function Lightbox({
  noteRef, images, index, onIndex, onClose, thumbUrl,
}: {
  noteRef: NoteRef;
  images: ImageRecord[];
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

  const cur = images[index];
  // 只有看图器会解原图。它用独立的 LRU(3)，退出后很快被挤掉释放
  const url = cur ? thumbUrl(noteRef, cur.file, 'full') : undefined;

  return (
    <div className="bw-lightbox" onClick={onClose}>
      <div className="bw-lb-bar">
        <span>{index + 1} / {images.length}</span>
        <span>{cur ? `${cur.width}×${cur.height} · ${(cur.bytes / 1024).toFixed(0)} KB · ${cur.source_kind}` : ''}</span>
        <span>← → 翻图 · Esc 退出</span>
      </div>
      <div className="bw-lb-img" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt="" /> : <p className="bw-empty">正在解码…</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写详情栏**

`src/browser/components/DetailPane.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { loadComments, type CommentsResult } from '../../core/browse/comments';
import { checkQuality, type QualityReport } from '../../core/browse/quality';
import type { NoteDetail, NoteRef, RowMeta } from '../../core/browse/types';
import { noteKeyOf } from '../../core/browse/scope';
import type { ReadStore } from '../../core/read-store';
import type { CommentRecord } from '../../types';
import type { ThumbSize } from '../hooks/useThumbnail';
import { Lightbox } from './Lightbox';

function qualityText(q: QualityReport): { tone: string; text: string } | null {
  switch (q.state.kind) {
    case 'ok':
      return null;
    case 'no_pointer':
      return { tone: 'warn', text: '当前目录没有对应的索引指针' };
    case 'pointer_elsewhere':
      return { tone: 'warn', text: `索引里这篇指向 ${q.state.paths.join('、')}，当前目录是遗留副本` };
    case 'race_diverged':
      return { tone: 'bad', text: `${q.state.pointers.length} 个采集者的指针指向不同目录，需人工清理` };
    case 'race_same_path':
      return { tone: 'warn', text: `${q.state.collectors.join('、')} 都登记了这份数据` };
    case 'invariant_broken':
      return { tone: 'bad', text: `指针存在但数据不完整，缺：${q.state.missing.join('、')}` };
  }
}

function Comment({ c, depth }: { c: CommentRecord; depth: number }) {
  return (
    <>
      <div className="bw-cmt" style={{ paddingLeft: depth * 14 }}>
        <b>{c.author.nickname}</b>
        {c.content && <span>：{c.content}</span>}
        {c.images.length > 0 && <span className="bw-dim">［{c.images.length} 张配图］</span>}
        <span className="bw-dim"> ❤ {c.liked_count}</span>
      </div>
      {(c.sub_comments ?? []).map((s) => <Comment key={s.id} c={s} depth={depth + 1} />)}
    </>
  );
}

export function DetailPane({
  store, noteRef, meta, detail, onClose, thumbUrl,
}: {
  store: ReadStore;
  noteRef: NoteRef;
  meta: RowMeta;
  detail: NoteDetail;
  onClose(): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
}) {
  const [comments, setComments] = useState<CommentsResult>({ kind: 'none' });
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const key = noteKeyOf(noteRef);
  useEffect(() => {
    let alive = true;
    setComments({ kind: 'none' });
    setQuality(null);
    void loadComments(store, noteRef).then((r) => { if (alive) setComments(r); });
    void checkQuality(store, noteRef, detail).then((r) => { if (alive) setQuality(r); });
    return () => { alive = false; };
  }, [store, key, detail, noteRef]);

  const q = quality ? qualityText(quality) : null;
  const missing = quality?.missingImages ?? [];

  return (
    <aside className="bw-detail">
      <div className="bw-detail-bar">
        <span className="bw-dim">{meta.title || '（无标题）'}</span>
        <button className="bw-btn" onClick={onClose}>✕</button>
      </div>

      <div className="bw-detail-body">
        <div className="bw-thumbs">
          {detail.images.map((img, i) => (
            <span
              key={img.file}
              className={`bw-thumb${missing.includes(img.file) ? ' missing' : ''}`}
              onClick={() => setLightbox(i)}
            >
              {(() => {
                const u = missing.includes(img.file) ? undefined : thumbUrl(noteRef, img.file, 320);
                return u ? <img src={u} alt="" /> : null;
              })()}
            </span>
          ))}
          {detail.images.length === 0 && <p className="bw-empty">没有图片</p>}
        </div>

        {missing.length > 0 && <p className="bw-note bad">{missing.length} 张图片文件缺失</p>}
        {q && <p className={`bw-note ${q.tone}`}>{q.text}</p>}

        <h3>{meta.title || '（无标题）'}</h3>
        <p className="bw-content">{meta.content}</p>
        {meta.tags.length > 0 && <p className="bw-dim">{meta.tags.map((t) => `#${t}`).join(' ')}</p>}

        <p>👤 {detail.author.nickname}</p>
        <p>❤ {meta.liked} &nbsp; ⭐ {meta.collected} &nbsp; 💬 {meta.comment} &nbsp; ↗ {meta.share}</p>
        <p className="bw-dim">
          发布 {meta.publishedAt.slice(0, 16).replace('T', ' ')}
          {meta.lastEditedAt !== meta.publishedAt && ` · 编辑 ${meta.lastEditedAt.slice(0, 16).replace('T', ' ')}`}
          {detail.ipLocation && ` · IP ${detail.ipLocation}`}
        </p>
        <p className="bw-dim">
          {meta.collector} 采集 · {meta.lastArchivedAt.slice(0, 16).replace('T', ' ')}
          · 第 {meta.archiveCount} 次 · {key}/
        </p>

        <hr />
        {comments.kind === 'none' && <p className="bw-dim">未采集评论</p>}
        {comments.kind === 'error' && <p className="bw-note bad">{comments.reason}</p>}
        {comments.kind === 'ok' && (
          <>
            <p>
              <b>评论 {comments.file.collected_count} / {comments.file.declared_total}</b>
              <span className="bw-dim">（采集时页面只加载了这些）</span>
            </p>
            {comments.file.comments.map((c) => <Comment key={c.id} c={c} depth={0} />)}
          </>
        )}
      </div>

      {lightbox !== null && (
        <Lightbox
          noteRef={noteRef}
          images={detail.images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          thumbUrl={thumbUrl}
        />
      )}
    </aside>
  );
}
```

这一版评论配图只显示条数，不渲染图。**如果验收时觉得必须看到配图**，把 `Comment` 里的 `［N 张配图］` 换成对每张调用 `thumbUrl(noteRef, img.file, 96)` 的 `<img>`——`CommentImageRecord.file` 已经是相对笔记目录的路径（`images/comments/…`），而 `thumbUrl` 内部会补上笔记目录前缀，所以直接传 `img.file` 即可，`commentImagePath` 只在需要自己拼绝对路径时才用得上。

- [ ] **Step 3: 接进 App，加键盘与拖宽**

`src/browser/App.tsx`：加 import

```tsx
import { DetailPane } from './components/DetailPane';
```

在 state 区加：

```tsx
  const [detailOpen, setDetailOpen] = useState(true);
  const [paneWidth, setPaneWidth] = useState(() => Number(localStorage.getItem('bw.paneWidth') ?? 380));
  const [cursor, setCursor] = useState(0);

  useEffect(() => { localStorage.setItem('bw.paneWidth', String(paneWidth)); }, [paneWidth]);

  // ↑↓ 换行、Enter 开详情、Esc 关详情。看图器自己也监听 Esc，
  // 它在更内层且会 stopPropagation 之外还先执行，所以不会互相打架
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(refs.length - 1, c + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      if (e.key === 'Enter') setDetailOpen(true);
      if (e.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refs.length]);

  const current = refs[cursor];
  const currentKey = current ? noteKeyOf(current) : null;
  const currentState = current ? stateOf(current) : null;
```

把 `<Table … />` 的 `wide` 与选中改为受控：

```tsx
              wide={!detailOpen}
              selectedKey={currentKey}
              onSelect={(r) => { setCursor(refs.findIndex((x) => noteKeyOf(x) === noteKeyOf(r))); setDetailOpen(true); }}
```

在 `</div>`（`bw-list`）之后、`</div>`（`bw-main`）之前插入：

```tsx
          {detailOpen && current && currentState?.kind === 'ready' && store && (
            <>
              <div
                className="bw-resizer"
                onMouseDown={(e) => {
                  const x0 = e.clientX;
                  const w0 = paneWidth;
                  const move = (ev: MouseEvent) => setPaneWidth(Math.min(720, Math.max(280, w0 - (ev.clientX - x0))));
                  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                  window.addEventListener('mousemove', move);
                  window.addEventListener('mouseup', up);
                }}
              />
              <div style={{ width: paneWidth, flex: 'none', display: 'flex' }}>
                <DetailPane
                  store={store}
                  noteRef={current}
                  meta={currentState.meta}
                  detail={sink.details.get(currentKey!)!}
                  onClose={() => setDetailOpen(false)}
                  thumbUrl={thumbUrl}
                />
              </div>
            </>
          )}
```

其中 `sink` 来自 `useRows` 的返回值，把解构改成 `const { stateOf, request, sink } = useRows(store, refs);`。

- [ ] **Step 4: 补样式**

在 `src/browser/browser.css` 末尾追加：

```css
/* ── 详情栏 ───────────────────────────────────────────── */
.bw-resizer { flex: none; width: 4px; cursor: col-resize; background: var(--line); }
.bw-resizer:hover { background: var(--line-2); }

.bw-detail {
  flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column;
  border-left: 1px solid var(--line); background: var(--surface);
}
.bw-detail-bar {
  flex: none; display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 6px 10px; border-bottom: 1px solid var(--line);
}
.bw-detail-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 12px; }
.bw-detail-body h3 { margin: 8px 0 4px; font-size: 14px; }
.bw-detail-body p { margin: 3px 0; font-size: 12px; color: var(--ink-2); }
.bw-content { white-space: pre-wrap; color: var(--ink) !important; }
.bw-dim { color: var(--ink-3); }

.bw-thumbs { display: flex; flex-wrap: wrap; gap: 4px; }
.bw-thumb {
  width: 72px; height: 72px; border-radius: 5px; background: var(--sunk);
  overflow: hidden; display: block; cursor: zoom-in;
}
.bw-thumb.missing { outline: 1px dashed var(--accent); cursor: not-allowed; }
.bw-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

.bw-note { padding: 5px 8px; border-radius: 6px; font-size: 12px; }
.bw-note.warn { background: var(--warn-w); color: var(--warn); }
.bw-note.bad { background: var(--accent-w); color: var(--accent); }

.bw-cmt { font-size: 12px; color: var(--ink-2); padding: 2px 0; }

/* ── 看图器 ───────────────────────────────────────────── */
.bw-lightbox {
  position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.86);
  display: flex; flex-direction: column;
}
.bw-lb-bar {
  flex: none; display: flex; justify-content: space-between; gap: 12px;
  padding: 8px 14px; color: #ddd; font-size: 12px;
}
.bw-lb-img { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; padding: 12px; }
.bw-lb-img img { max-width: 100%; max-height: 100%; object-fit: contain; }
```

- [ ] **Step 5: 构建并验收**

Run: `npm run build`
Expected: 构建成功

在 Chrome 里确认：

1. 点一行，右侧详情栏出现：图片条、标题、正文、标签、作者、四个互动数、发布/编辑时间/IP、采集信息、评论
2. `↑` `↓` 换行时详情跟着变；`Esc` 关闭详情栏，关闭后列表变宽并多出分享、图片数、采集者、落盘路径几列；`Enter` 重新打开
3. 拖动详情栏左边缘能改宽度，刷新页面后宽度还在
4. 点缩略图进全屏看图器，`←` `→` 翻图，`Esc` 退出；退出后 DevTools Memory 里没有持续增长
5. 没有 `comments.json` 的笔记显示「未采集评论」，不是报错
6. 删掉某篇的一张图片文件后重新加载，详情栏出现「N 张图片文件缺失」，该缩略图带红色虚线框
7. 手工在 `_index/` 里把某篇的指针文件删掉，详情栏出现「当前目录没有对应的索引指针」
8. 手工把某篇的指针 `path` 改成另一个目录，详情栏出现「索引里这篇指向 …，当前目录是遗留副本」

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 详情栏、看图器与数据质量提示

详情栏复用行加载时已经拿到的 NoteDetail，不再读第二遍 note.json。
原图只在看图器里解码，走独立的 LRU(3)，退出后很快被挤掉释放。

质量提示比对 pointer.path 与当前物理路径，六种状态分开显示；
「指针存在但数据不完整」用最醒目的样式——它意味着别人的查重结果是错的。"
```

---

### Task 16: 顶栏功能与扫描

**Files:**
- Create: `src/browser/components/TopBar.tsx`
- Modify: `src/browser/App.tsx`, `src/browser/components/Table.tsx`, `src/browser/browser.css`

**Interfaces:**
- Consumes: `scanScope` `ScanResult`（Task 12）、`filterRefs` `sortRefs` `Sort`（Task 8）、`SortKey`（Task 4）、`loadComments`（Task 6）
- Produces: `<TopBar … />`；App 内的 `ensureScanned(): Promise<boolean>`

- [ ] **Step 1: 写顶栏**

`src/browser/components/TopBar.tsx`：

```tsx
export interface ScanState {
  running: boolean;
  done: number;
  total: number;
  /** 上一次扫描的失败清单，扫完才有 */
  failures: { path: string; reason: string }[];
}

export function TopBar({
  rootName, crumb, count, query, onQuery, collector, collectors, onCollector,
  showCommentCol, onShowCommentCol, detailOpen, onDetailOpen, onReload,
  buildProgress, scan, onCancelScan,
}: {
  rootName: string;
  crumb: string;
  count: number;
  query: string;
  onQuery(q: string): void;
  collector: string | null;
  collectors: string[];
  onCollector(c: string | null): void;
  showCommentCol: boolean;
  onShowCommentCol(v: boolean): void;
  detailOpen: boolean;
  onDetailOpen(v: boolean): void;
  onReload(): void;
  buildProgress: string | null;
  scan: ScanState;
  onCancelScan(): void;
}) {
  return (
    <header className="bw-top">
      <span className="bw-brand"><span className="dot" />数据集浏览</span>
      <span className="bw-root">{rootName}</span>
      <span className="bw-crumb">{crumb} · {count} 篇</span>

      <input
        className="bw-search"
        placeholder="搜索标题、正文、作者、标签"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />

      <select
        className="bw-btn"
        value={collector ?? ''}
        onChange={(e) => onCollector(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">采集者：全部</option>
        {collectors.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <label className="bw-check">
        <input type="checkbox" checked={showCommentCol} onChange={(e) => onShowCommentCol(e.target.checked)} />
        已采评论列
      </label>

      <button className="bw-btn" onClick={() => onDetailOpen(!detailOpen)}>
        {detailOpen ? '关闭详情' : '打开详情'}
      </button>

      <span className="bw-spacer" />

      {buildProgress && <span className="bw-progress">正在读取目录 · {buildProgress}</span>}
      {scan.running && (
        <span className="bw-progress">
          正在读取 {scan.done} / {scan.total}
          <button className="bw-btn" onClick={onCancelScan}>取消</button>
        </span>
      )}
      {!scan.running && scan.failures.length > 0 && (
        <span className="bw-progress" title={scan.failures.map((f) => `${f.path}：${f.reason}`).join('\n')}>
          {scan.failures.length} 篇读取失败
        </span>
      )}

      <button className="bw-btn" onClick={onReload}>重新加载</button>
    </header>
  );
}
```

- [ ] **Step 2: 在 App 里接上扫描与排序**

`src/browser/App.tsx` 里加：

```tsx
import { scanScope } from '../core/browse/scan';
import { filterRefs, sortRefs, type Sort } from '../core/browse/search';
import { TopBar, type ScanState } from './components/TopBar';
```

state 与逻辑：

```tsx
  const [query, setQuery] = useState('');
  const [collector, setCollector] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'default', desc: false });
  const [showCommentCol, setShowCommentCol] = useState(false);
  const [scan, setScan] = useState<ScanState>({ running: false, done: 0, total: 0, failures: [] });
  const [scanned, setScanned] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const scopeId = useMemo(() => `${selected ?? '*'}::${refs.length}`, [selected, refs.length]);

  /**
   * 排序、搜索、按采集者筛选都要整个范围的元数据，做不到懒加载，
   * 所以做成显式动作：先问一句，再带进度扫，可取消。
   */
  const ensureScanned = useCallback(async (): Promise<boolean> => {
    if (store === null || scanned === scopeId) return true;
    if (!window.confirm(`需要读取当前范围的 ${refs.length} 篇笔记，才能排序或搜索。继续？`)) return false;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setScan({ running: true, done: 0, total: refs.length, failures: [] });
    const r = await scanScope(store, refs, sink, {
      signal: ctrl.signal,
      onProgress: (done, total) => setScan((s) => ({ ...s, done, total })),
    });
    setScan({
      running: false, done: r.loaded + r.skipped, total: refs.length,
      failures: r.failures.map((f) => ({ path: noteKeyOf(f.ref), reason: f.reason })),
    });
    // 取消了就不打标记：半份数据不能拿去排序或搜索，那会让用户
    // 看到一个没有说明的子集
    if (r.completed) setScanned(scopeId);
    return r.completed;
  }, [store, scanned, scopeId, refs, sink]);

  const visible = useMemo(
    () => sortRefs(filterRefs(refs, sink.metas, { query, collector }), sink.metas, sort),
    [refs, sink, query, collector, sort, version],
  );

  const collectors = useMemo(
    () => [...new Set([...sink.metas.values()].map((m) => m.collector))].filter((c) => c !== '').sort(),
    [sink, version],
  );
```

`useRows` 的解构补上 `version`：`const { stateOf, request, sink, version } = useRows(store, refs);`

把渲染里的 `<Table refs={refs} …>` 改为 `refs={visible}`，并把顶栏换成 `<TopBar … />`，把原来那段 `<header className="bw-top">…</header>` 整块删掉。

搜索框与采集者下拉在改变前先扫描：

```tsx
        <TopBar
          rootName={rootName}
          crumb={selected ?? '全部'}
          count={visible.length}
          query={query}
          onQuery={(q) => { void (async () => { if (q === '' || await ensureScanned()) setQuery(q); })(); }}
          collector={collector}
          collectors={collectors}
          onCollector={(c) => { void (async () => { if (c === null || await ensureScanned()) setCollector(c); })(); }}
          showCommentCol={showCommentCol}
          onShowCommentCol={setShowCommentCol}
          detailOpen={detailOpen}
          onDetailOpen={setDetailOpen}
          onReload={() => { setScanned(null); reload(); }}
          buildProgress={progress ? `${progress.done} · ${progress.current}` : null}
          scan={scan}
          onCancelScan={() => abort.current?.abort()}
        />
```

- [ ] **Step 3: 表头点击排序**

`src/browser/components/Table.tsx`：props 加 `sort: Sort`、`onSort(key: SortKey): void`，把表头的 `<span>` 换成可点的：

```tsx
  const th = (key: SortKey, label: string, cls: string) => (
    <span
      className={`${cls} th${sort.key === key ? ' on' : ''}`}
      onClick={() => onSort(key)}
    >
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </span>
  );
```

表头改为 `{th('title', '标题', 'c-title')}`、`{th('liked', '赞', 'c-num')}` 等，`c-cover` 那一列保持不可点。

App 里传：

```tsx
              sort={sort}
              onSort={(key) => { void (async () => {
                if (!(await ensureScanned())) return;
                setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
              })(); }}
```

样式追加：

```css
.bw-head .th { cursor: pointer; }
.bw-head .th:hover { color: var(--ink); }
.bw-head .th.on { color: var(--accent); }
.bw-search {
  flex: 1 1 200px; min-width: 120px; padding: 4px 8px; font: inherit; font-size: 12px;
  border: 1px solid var(--line-2); border-radius: 7px;
  background: var(--paper); color: var(--ink);
}
.bw-check { font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; }
```

- [ ] **Step 4: 已采评论列**

`Table.tsx` 的 props 加 `showCommentCol: boolean` 与 `commentCount(ref: NoteRef): number | undefined`，表头在 `评` 之后条件插入 `<span className="c-num">已采</span>`，行里插入 `<span className="c-num">{commentCount(ref) ?? '…'}</span>`。

App 里维护一张按需填充的表：

```tsx
  const [cmtCounts, setCmtCounts] = useState<Map<string, number>>(new Map());
  const cmtInflight = useRef(new Set<string>());

  // 这一列默认关，因为它要额外读一个 comments.json——每行的填充成本翻倍
  const commentCount = useCallback((ref: NoteRef) => {
    const key = noteKeyOf(ref);
    const hit = cmtCounts.get(key);
    if (hit !== undefined || store === null || !showCommentCol) return hit;
    if (cmtInflight.current.has(key)) return undefined;
    cmtInflight.current.add(key);
    void loadComments(store, ref).then((r) => {
      cmtInflight.current.delete(key);
      setCmtCounts((m) => new Map(m).set(key, r.kind === 'ok' ? r.file.collected_count : 0));
    });
    return undefined;
  }, [cmtCounts, store, showCommentCol]);
```

对应 import：`import { loadComments } from '../core/browse/comments';`

- [ ] **Step 5: 构建并验收**

Run: `npm run build`
Expected: 构建成功

在 Chrome 里确认：

1. 输入搜索词，先弹确认框说「需要读取 N 篇」，确认后出现进度，扫完列表被过滤
2. 扫描中点「取消」，扫描停止；再输一次搜索词还会再问一次（说明没打 scanned 标记）
3. 扫完之后再改搜索词或换排序，**不再**弹确认框，结果瞬时出现
4. 点表头「赞」，按点赞排序，再点一次反向，箭头跟着变
5. 采集者下拉里出现仓库里实际存在的采集者，选一个能筛出来
6. 勾上「已采评论列」，列表多出一列，数字逐个填上；取消勾选列消失
7. 换一个数据集后，搜索/排序又会重新问一次（范围变了）
8. 故意破坏两篇的 `note.json`，扫描完顶栏出现「2 篇读取失败」，鼠标悬停能看到是哪两篇

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 顶栏搜索、排序、采集者筛选与显式扫描

这三件事都要整个范围的元数据，做不到懒加载，所以做成显式动作：
先问一句、带进度、可取消。取消后不打 scanned 标记——半份数据拿去
排序或搜索会让用户看到一个没有说明的子集。

已采评论列默认关：它要额外读一个 comments.json，行的填充成本翻倍。"
```

---

### Task 17: 端到端验收与文档同步

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-08-04-dataset-browser-design.md`

- [ ] **Step 1: 跑全量测试与构建**

Run: `npm test && npm run build`
Expected: 全绿，构建成功

- [ ] **Step 2: 走完整验收清单**

在 `chrome://extensions` 重新加载 `dist/`，逐条确认：

**入口与权限**
1. 侧边栏配置完成后顶栏出现浏览按钮；未配置时不出现
2. 点按钮打开新标签页；再点激活同一个而不是开第二个
3. 重启浏览器后首次打开浏览页，出现授权按钮，点击后能连上
4. 把数据仓库目录改名（模拟句柄失效），页面给出可读提示而不是白屏

**树与范围**
5. 树秒开，各节点篇数正确
6. 多级自定义路径（手工建一个 `research/2026-q3/outfit/<24位hex>/`）能正确展开
7. 数据集目录里手工建一个 `misc/`，该数据集仍然是叶子，篇数不变
8. 手工建一个空的 `collected/2026-08-05/`，它不出现在树上

**列表**
9. 缩略图逐个出现；快速滚动不卡；内存不持续上涨
10. 表头点击排序，四个互动数各自成列
11. 搜索、采集者筛选按显式扫描流程走，可取消

**详情**
12. `↑` `↓` 换行详情跟着变，`Esc` 关，`Enter` 开
13. 详情栏拖宽后刷新仍记得
14. 看图器 `←` `→` 翻图、`Esc` 退出
15. 无评论的笔记显示「未采集评论」

**质量提示**（需要手工制造）
16. 删掉某篇的指针 → 「当前目录没有对应的索引指针」
17. 改某篇指针的 `path` 指向别处 → 「遗留副本」
18. 给同一篇写两个采集者的指针、`path` 不同 → 「指针指向不同目录，需人工清理」
19. 保留指针但删掉一张图片 → 「指针存在但数据不完整」，红色
20. 破坏 `note.json` → 该行红色「读取失败」，其他行正常

**主题**
21. 系统深浅主题切换后两个页面配色都跟着变

遇到问题就修，修完重跑这一条。

- [ ] **Step 3: 同步文档**

`CLAUDE.md` 的「现状」一节，在验收期间新增项后面追加一条：

```markdown
- **数据集浏览页**：独立标签页只读浏览全仓库，入口在侧边栏顶栏。三栏（目录树 | 表格列表 | 可关详情栏）。设计见 `docs/superpowers/specs/2026-08-04-dataset-browser-design.md`
```

并在「实测硬事实」一节追加：

```markdown
- **`archive.status` 在磁盘上恒为 `complete`**。`archiver.ts` 里 partial 那条路径 `return` 在任何 `writeFile` 之前，根本不写文件。判断数据完不完整只能比对 `images[]` 与磁盘上真实存在的文件。
- **浏览页的「只读」由模块边界保证，不是权限保证。** `queryPermission({mode:'read'})` 只查询状态，不会把 readwrite 句柄降权。`src/core/browse/*` 与 `src/browser/*` 的存储参数一律写 `ReadStore`。
```

在「已定的决策」表格追加两行：

```markdown
| 浏览页不写盘、不重选目录 | 不要在浏览页加删除/移动/改归属，也不要加目录选择器 |
| 缓存键用物理路径而非 note_id | 竞态时同一篇在多个目录，用 note_id 做键会让两行互相串数据 |
```

`README.md` 的「迭代范围」一节，把 v2 那行改为：

```markdown
- **v2**：数据集浏览页（独立标签页只读浏览）、手动批量查重
```

如果 Task 1 Step 6 退到了 `options_page` 备选方案，把设计文档 §7 里的方案与备选对调，并说明为什么。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: 数据集浏览页验收完成，同步文档

补两条实测硬事实：archive.status 在磁盘上恒为 complete（partial 从不落盘），
以及浏览页的只读由模块边界而非权限保证。"
```

---

## 自查记录

**Spec 覆盖**：设计 §3 入口 → Task 1；§4.1 顶栏 → Task 13/16；§4.2 树 → Task 3/13；§4.3 列表 → Task 14/16；§4.4 详情 → Task 15；§4.5 质量提示 → Task 7/15；§5.2 建树成本与进度 → Task 3/13；§5.3 三层懒加载与 NoteKey → Task 4/5/14；§5.4 缩略图三尺寸与 LRU → Task 10/14/15；§5.5 显式扫描 → Task 12/16；§5.6 叶子判定 → Task 3；§5.7 重新加载 → Task 13；§6.1 ReadStore → Task 2；§6.2 模块表 → Task 3~12；§6.3 数据形状 → Task 3；§6.5 token → Task 1；§7 构建 → Task 1；§8.1 权限 → Task 1；§8.2 错误表 → Task 5/6/7/14/15；§9 测试 → 各任务的测试步骤；§11 memory-fs 改动 → Task 2。

**发现并补上的缺口**：设计 §6.2 的模块表没有列出 §5.5 描述的扫描逻辑，已补为 `scan.ts`（Task 12）；`RowState` 在设计里定义了但没说谁产出，已明确由 `useRows` 的 `stateOf` 给出（Task 14）。
