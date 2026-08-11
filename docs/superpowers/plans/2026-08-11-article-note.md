# Article Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让采集者在采集时填写文章级多行 Note，并能在侧边栏和数据集浏览页通过可选的 `annotation.txt` 持续编辑，同时在更新、接管和迁移中安全保留内容。

**Architecture:** 新增一个纯 TypeScript 的文章 annotation 存储模块，统一文件名、换行规范化和读写/删除语义；归档核心通过 `noteText?: string` 的三态接口处理保留、替换和清空。侧边栏用按 `note_id` 缓存的 hook 管理会话草稿，浏览页只在详情组件挂载时按需读取 annotation，因此列表扫描和搜索路径保持不变。

**Tech Stack:** TypeScript 7、React 19、Chrome File System Access API、Vitest 3、Testing Library、内存文件系统测试替身

---

## 文件结构与职责

新增文件：

- `src/core/article-note.ts`：`annotation.txt` 的唯一文件名与规范化、读取、写入、清空逻辑。
- `tests/core/article-note.test.ts`：核心文件语义和错误传播测试。
- `src/sidepanel/useArticleNote.ts`：按 `note_id` 保存侧边栏会话草稿，负责加载、取消、独立保存和归档成功后的状态对齐。
- `src/sidepanel/components/ArticleNoteEditor.tsx`：侧边栏 Note 的纯展示/交互组件，不直接访问文件系统。
- `tests/sidepanel/article-note.test.ts`：侧边栏 hook 和编辑器交互测试。
- `src/browser/components/AnnotationBlock.tsx`：浏览页详情中的按需加载、展示、编辑和保存组件。
- `tests/browser/annotation-block.test.ts`：浏览页 annotation 交互和错误测试。

修改文件：

- `src/core/archiver.ts`：接收 `noteText?: string`，在指针之前落盘，并在迁移时继承旧 annotation。
- `tests/core/archiver.test.ts`：覆盖首次采集、更新、接管、迁移及失败顺序。
- `src/sidepanel/App.tsx`：创建 Note 草稿控制器，执行权限检查与独立保存，并把归档覆盖意图传给核心。
- `src/sidepanel/components/NoteView.tsx`：在所有可采集/已采集结果视图中放置编辑器，并在 Note 写入时禁用冲突动作。
- `src/sidepanel/panel.css`：侧边栏编辑器样式。
- `src/browser/components/DetailPane.tsx`：在正文和作者之间挂载 `AnnotationBlock`，保存期间禁用删除。
- `src/browser/components/DeleteBlock.tsx`：接受外部 `disabled` 状态。
- `tests/browser/delete-block.test.ts`：验证 annotation 保存期间删除入口禁用。
- `src/browser/browser.css`：浏览页展示、编辑和错误状态样式。
- `README.md`：项目功能和数据目录示例。
- `src/core/repo-template.ts`：新建数据仓库 README 中的 annotation 说明。
- `tests/core/repo-template.test.ts`：验证生成说明包含 `annotation.txt` 及文章级语义。
- `CLAUDE.md`：记录完成后的行为约束，但不把未由使用者完成的真实浏览器验收写成硬事实。

明确不修改：

- `src/types.ts`：annotation 不进入 `note.json` schema。
- `src/core/browse/types.ts`、`src/core/browse/row-meta.ts`、`src/core/browse/search.ts`：annotation 不进入列表元数据、搜索、筛选或排序。
- `_index` 指针格式：独立修改 Note 不改变归档归属和时间。

---

### Task 1: 建立 `annotation.txt` 核心文件语义

**Files:**
- Create: `src/core/article-note.ts`
- Create: `tests/core/article-note.test.ts`

- [ ] **Step 1: 写失败测试，固定读取、规范化、写入和清空语义**

创建 `tests/core/article-note.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import {
  ANNOTATION_FILE,
  normalizeArticleNote,
  readArticleNote,
  writeArticleNote,
} from '../../src/core/article-note';

const DIR = 'collected/6a030b860000000036000201';
let store: Store;

beforeEach(() => { store = createStore(memRoot()); });

describe('article-note', () => {
  it('文件不存在时返回空内容', async () => {
    expect(await readArticleNote(store, DIR)).toBe('');
  });

  it('读取时去掉格式化用的最后一个换行', async () => {
    await store.writeFile(`${DIR}/${ANNOTATION_FILE}`, '第一行\n第二行\n');
    expect(await readArticleNote(store, DIR)).toBe('第一行\n第二行');
  });

  it('统一换行并保证非空文件只有一个结尾换行', () => {
    expect(normalizeArticleNote('第一行\r\n第二行\r\n\r\n')).toBe('第一行\n第二行\n');
  });

  it('纯空白输入归一化为 null', () => {
    expect(normalizeArticleNote(' \n\t\r\n')).toBeNull();
  });

  it('写入非空内容，清空时删除文件', async () => {
    await writeArticleNote(store, DIR, '观察一\r\n观察二');
    expect(await store.readText(`${DIR}/${ANNOTATION_FILE}`)).toBe('观察一\n观察二\n');

    await writeArticleNote(store, DIR, '   \n');
    expect(await store.exists(`${DIR}/${ANNOTATION_FILE}`)).toBe(false);
  });

  it('真实读取错误不会被当成空内容', async () => {
    const broken = { ...store, readText: async () => { throw new Error('read boom'); } };
    await expect(readArticleNote(broken, DIR)).rejects.toThrow('read boom');
  });

  it('写入和删除错误向调用方传播', async () => {
    const writeBroken: Store = {
      ...store,
      writeFile: async () => { throw new Error('write boom'); },
    };
    await expect(writeArticleNote(writeBroken, DIR, '内容')).rejects.toThrow('write boom');

    await store.writeFile(`${DIR}/${ANNOTATION_FILE}`, '内容\n');
    const deleteBroken: Store = {
      ...store,
      removeFile: async () => { throw new Error('delete boom'); },
    };
    await expect(writeArticleNote(deleteBroken, DIR, '')).rejects.toThrow('delete boom');
  });
});
```

- [ ] **Step 2: 运行测试并确认红灯原因正确**

Run: `npx vitest run tests/core/article-note.test.ts`

Expected: FAIL，提示无法解析 `../../src/core/article-note`。

- [ ] **Step 3: 实现最小核心模块**

创建 `src/core/article-note.ts`：

```ts
import type { ReadStore } from './read-store';
import type { Store } from './store';

export const ANNOTATION_FILE = 'annotation.txt';

function annotationPath(articlePath: string): string {
  return `${articlePath.replace(/\/+$/, '')}/${ANNOTATION_FILE}`;
}

function lf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function normalizeArticleNote(text: string): string | null {
  const normalized = lf(text);
  if (normalized.trim() === '') return null;
  return `${normalized.replace(/\n+$/, '')}\n`;
}

export async function readArticleNote(store: ReadStore, articlePath: string): Promise<string> {
  const text = await store.readText(annotationPath(articlePath));
  if (text === null) return '';
  const normalized = lf(text);
  return normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
}

export async function writeArticleNote(
  store: Store,
  articlePath: string,
  text: string,
): Promise<void> {
  const normalized = normalizeArticleNote(text);
  const path = annotationPath(articlePath);
  if (normalized === null) {
    await store.removeFile(path);
    return;
  }
  await store.writeFile(path, normalized);
}
```

- [ ] **Step 4: 运行核心测试并确认通过**

Run: `npx vitest run tests/core/article-note.test.ts`

Expected: PASS，7 tests passed。

- [ ] **Step 5: 提交核心文件语义**

```bash
git add src/core/article-note.ts tests/core/article-note.test.ts
git commit -m "feat: 增加文章人工标注文件读写"
```

---

### Task 2: 把 Note 纳入首次采集、更新、接管和迁移

**Files:**
- Modify: `src/core/archiver.ts`
- Modify: `tests/core/archiver.test.ts`

- [ ] **Step 1: 写失败测试，固定归档三态和迁移顺序**

在 `tests/core/archiver.test.ts` 引入 `ANNOTATION_FILE`，并增加以下用例。使用既有的 `goodNote()`、`okDeps()`、`lookup()` 和 `store`：

```ts
import { ANNOTATION_FILE } from '../../src/core/article-note';

const annotationAt = (path: string) => `${path}/${ANNOTATION_FILE}`;

describe('archive - 文章 Note', () => {
  it('首次采集写入 Note，空 Note 清理失败重试留下的文件', async () => {
    const dir = `collected/${NOTE_ID}`;
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'collected',
      mode: 'new', noteText: '判断一\r\n判断二', deps: okDeps(),
    });
    expect(await store.readText(annotationAt(dir))).toBe('判断一\n判断二\n');

    await store.removeDir('_index');
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'collected',
      mode: 'new', noteText: '', deps: okDeps(),
    });
    expect(await store.exists(annotationAt(dir))).toBe(false);
  });

  it('原位更新 undefined 保留、字符串替换、空字符串清空', async () => {
    const path = `collected/${NOTE_ID}`;
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'collected',
      mode: 'new', noteText: '旧内容', deps: okDeps(),
    });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'elsewhere', mode: 'update', existing, deps: okDeps() });
    expect(await readArticleNote(store, path)).toBe('旧内容');

    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'elsewhere', mode: 'update', existing, noteText: '新内容', deps: okDeps() });
    expect(await readArticleNote(store, path)).toBe('新内容');

    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'elsewhere', mode: 'update', existing, noteText: '', deps: okDeps() });
    expect(await store.exists(annotationAt(path))).toBe(false);
  });

  it('接管原位更新默认继承文章 Note', async () => {
    await archive({
      store, note: goodNote(), collector: 'lily', datasetPath: 'collected',
      mode: 'new', noteText: '公共判断', deps: okDeps(),
    });
    const existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'other', mode: 'update',
      existing, supersede: [existing], deps: okDeps(),
    });
    expect(await readArticleNote(store, existing.path)).toBe('公共判断');
  });

  it('迁移默认复制旧 Note，主动编辑时采用新内容', async () => {
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'old',
      mode: 'new', noteText: '旧内容', deps: okDeps(),
    });
    let existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'next',
      mode: 'migrate', existing, deps: okDeps(),
    });
    expect(await readArticleNote(store, `next/${NOTE_ID}`)).toBe('旧内容');

    existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'final',
      mode: 'migrate', existing, noteText: '迁移时修改', deps: okDeps(),
    });
    expect(await readArticleNote(store, `final/${NOTE_ID}`)).toBe('迁移时修改');
  });

  it('首次 Note 写入失败时不写指针', async () => {
    const broken: Store = {
      ...store,
      writeFile: async (path, data) => {
        if (path.endsWith(ANNOTATION_FILE)) throw new Error('annotation boom');
        await store.writeFile(path, data);
      },
    };
    await expect(archive({
      store: broken, note: goodNote(), collector: 'zach', datasetPath: 'collected',
      mode: 'new', noteText: '不能丢', deps: okDeps(),
    })).rejects.toThrow('Note 未保存，索引未写入');
    expect(await lookup(store, NOTE_ID)).toEqual([]);
  });

  it('原位更新 Note 写入失败时旧指针和旧 Note 保留', async () => {
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'collected',
      mode: 'new', noteText: '旧内容', deps: okDeps(),
    });
    const existing = (await lookup(store, NOTE_ID))[0]!;
    const broken: Store = {
      ...store,
      writeFile: async (path, data) => {
        if (path.endsWith(ANNOTATION_FILE)) throw new Error('annotation boom');
        await store.writeFile(path, data);
      },
    };
    await expect(archive({
      store: broken, note: goodNote(), collector: 'zach', datasetPath: 'elsewhere',
      mode: 'update', existing, noteText: '新内容', deps: okDeps(),
    })).rejects.toThrow('文章数据可能已更新，原索引仍保留');
    expect((await lookup(store, NOTE_ID))[0]!.path).toBe(existing.path);
    expect(await readArticleNote(store, existing.path)).toBe('旧内容');
  });

  it('迁移读取旧 Note 失败时不写新目录、不移动指针', async () => {
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'old',
      mode: 'new', noteText: '旧内容', deps: okDeps(),
    });
    const existing = (await lookup(store, NOTE_ID))[0]!;
    const broken: Store = {
      ...store,
      readText: async (path) => {
        if (path.endsWith(ANNOTATION_FILE)) throw new Error('read boom');
        return store.readText(path);
      },
    };
    await expect(archive({
      store: broken, note: goodNote(), collector: 'zach', datasetPath: 'next',
      mode: 'migrate', existing, deps: okDeps(),
    })).rejects.toThrow('Note 读取失败，旧目录保留');
    expect(await store.exists(`next/${NOTE_ID}/note.json`)).toBe(false);
    expect((await lookup(store, NOTE_ID))[0]!.path).toBe(existing.path);
  });

  it('迁移 Note 失败时旧目录和旧指针保留', async () => {
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'old',
      mode: 'new', noteText: '必须保留', deps: okDeps(),
    });
    const existing = (await lookup(store, NOTE_ID))[0]!;
    const broken: Store = {
      ...store,
      writeFile: async (path, data) => {
        if (path === `next/${NOTE_ID}/${ANNOTATION_FILE}`) throw new Error('annotation boom');
        await store.writeFile(path, data);
      },
    };
    await expect(archive({
      store: broken, note: goodNote(), collector: 'zach', datasetPath: 'next',
      mode: 'migrate', existing, deps: okDeps(),
    })).rejects.toThrow('Note 未保存');
    expect(await readArticleNote(store, existing.path)).toBe('必须保留');
    expect((await lookup(store, NOTE_ID))[0]!.path).toBe(existing.path);
  });
});
```

同时把 import 改为：

```ts
import { ANNOTATION_FILE, readArticleNote } from '../../src/core/article-note';
```

- [ ] **Step 2: 运行归档测试并确认因接口缺失而失败**

Run: `npx vitest run tests/core/archiver.test.ts`

Expected: FAIL，TypeScript/运行时显示 `ArchiveOptions` 不接受 `noteText`，且归档没有生成 annotation。

- [ ] **Step 3: 在归档核心解析有效 Note 意图**

在 `src/core/archiver.ts`：

```ts
import { readArticleNote, writeArticleNote } from './article-note';
```

在现有 `ArchiveOptions` 的 `comments?: ExtractedComments` 后加入：

```ts
/** undefined = 保留；字符串 = 替换；空白字符串 = 清空。 */
noteText?: string;
```

随后在模块内部加入：

```ts

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function noteTextForArchive(opts: ArchiveOptions, targetPath: string): Promise<string | undefined> {
  if (opts.noteText !== undefined) return opts.noteText;
  if (opts.mode === 'new') return '';
  if (opts.mode === 'migrate' && opts.existing && opts.existing.path !== targetPath) {
    try {
      return await readArticleNote(opts.store, opts.existing.path);
    } catch (error) {
      throw new Error(`Note 读取失败，旧目录保留：${errorText(error)}`);
    }
  }
  return undefined;
}
```

在 `archive()` 算出 `targetPath` 后、下载图片前调用：

```ts
const effectiveNoteText = await noteTextForArchive(opts, targetPath);
```

在文章数据与评论写完后、`writePointer()` 之前调用：

```ts
if (effectiveNoteText !== undefined) {
  try {
    await writeArticleNote(store, targetPath, effectiveNoteText);
  } catch (error) {
    const detail = errorText(error);
    if (existing) {
      throw new Error(`Note 未保存；文章数据可能已更新，原索引仍保留：${detail}`);
    }
    throw new Error(`Note 未保存，索引未写入：${detail}`);
  }
}
```

这段必须保持在写指针、删除被接管指针和删除迁移旧目录之前。

- [ ] **Step 4: 运行核心与归档测试**

Run: `npx vitest run tests/core/article-note.test.ts tests/core/archiver.test.ts`

Expected: PASS，现有归档用例和新增 Note 用例全部通过。

- [ ] **Step 5: 提交归档生命周期**

```bash
git add src/core/archiver.ts tests/core/archiver.test.ts
git commit -m "feat: 归档时保留文章 Note"
```

---

### Task 3: 建立侧边栏按文章缓存的草稿控制器

**Files:**
- Create: `src/sidepanel/useArticleNote.ts`
- Create: `tests/sidepanel/article-note.test.ts`

- [ ] **Step 1: 写失败的 hook 测试**

创建 `tests/sidepanel/article-note.test.ts`，先只加入 hook 用例：

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writeArticleNote } from '../../src/core/article-note';
import { useArticleNote } from '../../src/sidepanel/useArticleNote';

afterEach(cleanup);

const A = '6a030b860000000036000201';
const B = '6a030b860000000036000202';
const DIR = `collected/${A}`;

describe('useArticleNote', () => {
  it('加载已有 Note，并能取消回已保存内容', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '磁盘内容');
    const { result } = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value).toBe('磁盘内容');

    act(() => result.current.setValue('临时修改'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.value).toBe('磁盘内容');
  });

  it('按 note_id 保留当前侧边栏生命周期里的新文章草稿', () => {
    const store = createStore(memRoot());
    const props = { noteId: A, path: null as string | null };
    const { result, rerender } = renderHook(
      ({ noteId, path }) => useArticleNote(store, noteId, path),
      { initialProps: props },
    );
    act(() => result.current.setValue('A 的草稿'));
    rerender({ noteId: B, path: null });
    act(() => result.current.setValue('B 的草稿'));
    rerender({ noteId: A, path: null });
    expect(result.current.value).toBe('A 的草稿');
  });

  it('已有文章独立保存，失败时保留草稿和错误', async () => {
    const store = createStore(memRoot());
    const { result } = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setValue('要保存'));
    await act(async () => { expect(await result.current.save()).toBe(true); });
    expect(result.current.dirty).toBe(false);
    expect(result.current.notice).toBe('Note 已保存');

    const broken: Store = {
      ...store,
      writeFile: async () => { throw new Error('save boom'); },
    };
    const failed = renderHook(() => useArticleNote(broken, B, `collected/${B}`));
    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    act(() => failed.result.current.setValue('不能丢'));
    await act(async () => { expect(await failed.result.current.save()).toBe(false); });
    expect(failed.result.current.value).toBe('不能丢');
    expect(failed.result.current.error).toContain('save boom');
  });

  it('读取失败时不能把默认空值保存回磁盘', async () => {
    const base = createStore(memRoot());
    const broken: Store = {
      ...base,
      readText: async () => { throw new Error('read boom'); },
    };
    const { result } = renderHook(() => useArticleNote(broken, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toContain('read boom');
    await act(async () => { expect(await result.current.save()).toBe(false); });
  });

  it('归档值区分新文章、未编辑旧文章和明确清空', async () => {
    const store = createStore(memRoot());
    const fresh = renderHook(() => useArticleNote(store, A, null));
    expect(fresh.result.current.archiveValue).toBe('');

    await writeArticleNote(store, `collected/${B}`, '旧内容');
    const old = renderHook(() => useArticleNote(store, B, `collected/${B}`));
    await waitFor(() => expect(old.result.current.loading).toBe(false));
    expect(old.result.current.archiveValue).toBeUndefined();
    act(() => old.result.current.setValue(''));
    expect(old.result.current.archiveValue).toBe('');
  });

  it('归档成功后用新路径标记为已保存', () => {
    const store = createStore(memRoot());
    const { result } = renderHook(() => useArticleNote(store, A, null));
    act(() => result.current.setValue('一起保存'));
    act(() => result.current.markArchived(DIR));
    expect(result.current.path).toBe(DIR);
    expect(result.current.saved).toBe('一起保存');
    expect(result.current.dirty).toBe(false);
  });

  it('已归档文章可主动重新读取磁盘，未归档草稿不会被刷新清空', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '第一次读取');
    const archived = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(archived.result.current.loading).toBe(false));
    await writeArticleNote(store, DIR, '磁盘外部修改');
    act(() => archived.result.current.reload());
    await waitFor(() => expect(archived.result.current.value).toBe('磁盘外部修改'));

    const fresh = renderHook(() => useArticleNote(store, B, null));
    act(() => fresh.result.current.setValue('未提交草稿'));
    act(() => fresh.result.current.reload());
    expect(fresh.result.current.value).toBe('未提交草稿');
  });
});
```

- [ ] **Step 2: 运行 hook 测试确认红灯**

Run: `npx vitest run tests/sidepanel/article-note.test.ts`

Expected: FAIL，提示无法解析 `src/sidepanel/useArticleNote.ts`。

- [ ] **Step 3: 实现草稿 map 与公开接口**

创建 `src/sidepanel/useArticleNote.ts`，公开接口固定为：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readArticleNote, writeArticleNote } from '../core/article-note';
import type { Store } from '../core/store';

interface Entry {
  path: string | null;
  saved: string;
  value: string;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
}

const emptyEntry = (path: string | null): Entry => ({
  path, saved: '', value: '', loading: path !== null,
  saving: false, loaded: path === null, error: null, notice: null,
});

export interface ArticleNoteController extends Entry {
  dirty: boolean;
  archiveValue: string | undefined;
  setValue(value: string): void;
  cancel(): void;
  save(): Promise<boolean>;
  markArchived(path: string): void;
  reload(): void;
}

export function useArticleNote(
  store: Store | null,
  noteId: string | null,
  existingPath: string | null,
): ArticleNoteController {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const handledReload = useRef(0);
  const key = noteId ?? '';
  const current = entries[key] ?? emptyEntry(existingPath);

  useEffect(() => {
    if (!noteId) return;
    const hit = entries[noteId];
    const forced = reloadToken !== handledReload.current;
    if (forced) handledReload.current = reloadToken;
    if (existingPath === null) {
      if (!hit) setEntries((all) => ({ ...all, [noteId]: emptyEntry(null) }));
      return;
    }
    if (hit?.loaded && hit.path === existingPath && !forced) return;
    let alive = true;
    setEntries((all) => ({ ...all, [noteId]: emptyEntry(existingPath) }));
    if (!store) return () => { alive = false; };
    void readArticleNote(store, existingPath).then(
      (text) => {
        if (!alive) return;
        setEntries((all) => ({ ...all, [noteId]: {
          path: existingPath, saved: text, value: text,
          loading: false, saving: false, loaded: true, error: null, notice: null,
        } }));
      },
      (error) => {
        if (!alive) return;
        setEntries((all) => ({ ...all, [noteId]: {
          ...emptyEntry(existingPath), loading: false, loaded: false,
          error: `Note 读取失败：${error instanceof Error ? error.message : String(error)}`,
        } }));
      },
    );
    return () => { alive = false; };
  }, [store, noteId, existingPath, reloadToken]);

  const patch = useCallback((fn: (entry: Entry) => Entry) => {
    if (!noteId) return;
    setEntries((all) => ({ ...all, [noteId]: fn(all[noteId] ?? emptyEntry(existingPath)) }));
  }, [noteId, existingPath]);

  const setValue = useCallback((value: string) => patch((e) => ({ ...e, value, error: null, notice: null })), [patch]);
  const cancel = useCallback(() => patch((e) => ({ ...e, value: e.saved, error: null, notice: null })), [patch]);
  const save = useCallback(async () => {
    if (!store || !noteId || current.path === null || current.loading || !current.loaded) return false;
    patch((e) => ({ ...e, saving: true, error: null, notice: null }));
    try {
      await writeArticleNote(store, current.path, current.value);
      patch((e) => ({ ...e, saved: e.value, saving: false, error: null, notice: 'Note 已保存' }));
      return true;
    } catch (error) {
      patch((e) => ({ ...e, saving: false, error: error instanceof Error ? error.message : String(error) }));
      return false;
    }
  }, [store, noteId, current.path, current.value, current.loading, current.loaded, patch]);
  const markArchived = useCallback((path: string) => patch((e) => ({
    ...e, path, saved: e.value, loading: false, saving: false, loaded: true, error: null, notice: null,
  })), [patch]);
  const reload = useCallback(() => {
    if (current.path !== null) setReloadToken((n) => n + 1);
  }, [current.path]);

  return useMemo(() => ({
    ...current,
    dirty: current.value !== current.saved,
    archiveValue: current.path === null || current.value !== current.saved ? current.value : undefined,
    setValue, cancel, save, markArchived, reload,
  }), [current, setValue, cancel, save, markArchived, reload]);
}
```

- [ ] **Step 4: 运行 hook 测试并修正状态竞态**

Run: `npx vitest run tests/sidepanel/article-note.test.ts`

Expected: PASS，7 tests passed；测试输出没有 `act(...)` 警告。

- [ ] **Step 5: 提交侧边栏状态控制器**

```bash
git add src/sidepanel/useArticleNote.ts tests/sidepanel/article-note.test.ts
git commit -m "feat: 保留侧边栏文章 Note 草稿"
```

---

### Task 4: 在侧边栏接入填写、独立保存和随归档保存

**Files:**
- Create: `src/sidepanel/components/ArticleNoteEditor.tsx`
- Modify: `src/sidepanel/components/NoteView.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/panel.css`
- Modify: `tests/sidepanel/article-note.test.ts`
- Modify: `tests/sidepanel/delete-ui.test.ts`

- [ ] **Step 1: 给编辑器和 NoteView 写失败交互测试**

在 `tests/sidepanel/article-note.test.ts` 增加：

```tsx
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { ArticleNoteEditor } from '../../src/sidepanel/components/ArticleNoteEditor';

describe('ArticleNoteEditor', () => {
  it('新文章只提示随采集保存，不显示独立保存按钮', () => {
    render(createElement(ArticleNoteEditor, {
      archived: false, value: '', saved: '', loading: false, saving: false,
      loaded: true, disabled: false, error: null, notice: null,
      onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText('将在采集文章时一并保存')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
  });

  it('已归档文章修改后可以保存或取消', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(createElement(ArticleNoteEditor, {
      archived: true, value: '改后', saved: '改前', loading: false, saving: false,
      loaded: true, disabled: false, error: null, notice: null, onChange, onSave, onCancel,
    }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note（可选）' }), { target: { value: '继续改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onChange).toHaveBeenCalledWith('继续改');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('加载和保存期间禁用输入，错误内容可见', () => {
    const { rerender } = render(createElement(ArticleNoteEditor, {
      archived: true, value: '', saved: '', loading: true, saving: false,
      loaded: false, disabled: false, error: null, notice: null,
      onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
    rerender(createElement(ArticleNoteEditor, {
      archived: true, value: '不能丢', saved: '', loading: false, saving: false, disabled: false,
      loaded: true, error: 'save boom', notice: null, onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText(/save boom/)).toBeTruthy();
    expect(screen.getByDisplayValue('不能丢')).toBeTruthy();
  });

  it('保存成功给出轻量反馈，外部写入时禁用编辑', () => {
    render(createElement(ArticleNoteEditor, {
      archived: true, value: '已存', saved: '已存', loading: false, saving: false, disabled: true,
      loaded: true, error: null, notice: 'Note 已保存', onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText('Note 已保存')).toBeTruthy();
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
  });
});
```

在 `tests/sidepanel/delete-ui.test.ts` 的 `noteViewProps()` 增加完整默认 props，避免既有 SSR 测试靠 `as never` 漏掉行为：

```ts
noteText: '',
noteSaved: '',
noteLoading: false,
noteSaving: false,
noteLoaded: true,
noteError: null,
noteNotice: null,
deleteBusy: false,
onNoteChange: vi.fn(),
onSaveNote: vi.fn(),
onCancelNote: vi.fn(),
```

并增加两组断言：`noteSaving: true` 时“更新”和“删除这篇”按钮均为 disabled；
`deleteBusy: true` 时 Note 文本框和“更新”按钮均为 disabled。

- [ ] **Step 2: 运行侧边栏测试确认组件和 props 尚不存在**

Run: `npx vitest run tests/sidepanel/article-note.test.ts tests/sidepanel/delete-ui.test.ts`

Expected: FAIL，提示 `ArticleNoteEditor` 不存在或 `NoteView` 缺少新 props。

- [ ] **Step 3: 创建纯展示编辑器**

创建 `src/sidepanel/components/ArticleNoteEditor.tsx`：

```tsx
export interface ArticleNoteEditorProps {
  archived: boolean;
  value: string;
  saved: string;
  loading: boolean;
  saving: boolean;
  loaded: boolean;
  disabled: boolean;
  error: string | null;
  notice: string | null;
  onChange(value: string): void;
  onSave(): void;
  onCancel(): void;
}

export function ArticleNoteEditor(props: ArticleNoteEditorProps) {
  const dirty = props.value !== props.saved;
  const busy = props.loading || props.saving || props.disabled || (props.archived && !props.loaded);
  return (
    <section className="article-note">
      <div className="sect-h">Note <span>可选</span></div>
      <textarea
        aria-label="Note（可选）"
        value={props.value}
        disabled={busy}
        placeholder={props.loading ? '正在读取 Note…' : '记录对这篇文章的判断或补充信息'}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {!props.archived && <p className="hint">将在采集文章时一并保存</p>}
      {props.error && <p className="field-err">{props.error}</p>}
      {props.notice && <p className="hint">{props.notice}</p>}
      {props.archived && dirty && (
        <div className="article-note-actions">
          <button className="btn btn-sm" disabled={busy} onClick={props.onCancel}>取消</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={props.onSave}>
            {props.saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 在 NoteView 所有可采集分支渲染编辑器并传递 busy**

在 `src/sidepanel/components/NoteView.tsx` 增加编辑器所需 props，并加入 `deleteBusy: boolean`。
在 `archivable(state)` 成功后构造：

```tsx
const noteEditor = (
  <ArticleNoteEditor
    archived={a.existing !== null}
    value={noteText}
    saved={noteSaved}
    loading={noteLoading}
    saving={noteSaving}
    loaded={noteLoaded}
    disabled={progress !== null || pageStep !== null || deleteBusy}
    error={noteError}
    notice={noteNotice}
    onChange={onNoteChange}
    onSave={onSaveNote}
    onCancel={onCancelNote}
  />
);
```

把它放在每个 `<NoteCard ... />` 后面，包括正常状态、`justArchived` 和 `justDeleted` 分支。底部动作的 busy 统一为：

```ts
const noteBusy = noteLoading || noteSaving || deleteBusy;
```

并传给：

```tsx
<ArchiveActions busy={noteBusy} ... />
<DeleteAction busy={noteBusy} ... />
```

采集的 `progress` / `pageStep` 同时会禁用 Note 文本框；确认删除真正执行期间由
`deleteBusy` 禁用 Note 保存和归档动作。

- [ ] **Step 5: 在 App 中创建控制器并接入归档与独立保存**

在 `src/sidepanel/App.tsx` 取得当前归档计划后创建控制器：

```ts
import { useArticleNote } from './useArticleNote';

const currentPlan = planOf(state);
const articleNote = useArticleNote(
  store,
  currentPlan?.note.noteId ?? null,
  currentPlan?.existing?.path ?? null,
);
```

在 `doArchive()` 调用核心时加入：

```ts
noteText: articleNote.archiveValue,
```

只有 `res.status === 'complete'` 时执行：

```ts
articleNote.markArchived(res.path);
```

增加独立保存 handler，权限检查顺序与 `doArchive()` 一致：

```ts
async function saveCurrentNote() {
  if (!root || !store) return;
  if (!(await ensurePermission(root))) {
    setMessage('目录授权已失效，Note 没有保存。请重新授权后再试。');
    return;
  }
  if (!(await rootExists(root))) {
    setMessage('数据仓库目录已不存在，Note 没有保存。');
    setState({ kind: 'missing_root' });
    return;
  }
  await articleNote.save();
}
```

向 `NoteView` 传入：

```tsx
noteText={articleNote.value}
noteSaved={articleNote.saved}
noteLoading={articleNote.loading}
noteSaving={articleNote.saving}
noteLoaded={articleNote.loaded}
noteError={articleNote.error}
noteNotice={articleNote.notice}
deleteBusy={deleteBusy}
onNoteChange={articleNote.setValue}
onSaveNote={() => void saveCurrentNote()}
onCancelNote={articleNote.cancel}
```

顶栏“重新读取页面”是使用者主动要求同步磁盘内容的入口，改为：

```tsx
<button
  className="icon-btn"
  title="重新读取页面"
  onClick={() => { articleNote.reload(); void refresh(); }}
>
  <IconRefresh />
</button>
```

`reload()` 对尚未归档、没有物理路径的草稿是空操作，所以不会因刷新页面判定而清空新文章输入。

在 App state 中增加：

```ts
const [deleteBusy, setDeleteBusy] = useState(false);
```

把 `confirmDelete()` 改为：

```ts
async function confirmDelete() {
  if (!store || !root || !deletePlan) return;
  if (!(await ensurePermission(root))) {
    setMessage('目录授权已失效，什么都没删。请重新授权后再试。');
    return;
  }
  const plan = deletePlan;
  let res: DeleteResult;
  setDeleteBusy(true);
  try {
    res = await deleteNote(store, plan);
  } catch (e) {
    if (isMissingError(e)) {
      setMessage('数据仓库目录已不存在，删除没有完成。');
      setState({ kind: 'missing_root' });
      return;
    }
    setMessage(`删除失败：${e instanceof Error ? e.message : String(e)}。索引指针可能已删除，数据目录可能有残留。`);
    return;
  } finally {
    setDeleteBusy(false);
  }
  await refresh();
  setJustDeleted(res);
}
```

这样删除真正写盘期间，Note 保存和归档按钮都不可用。

- [ ] **Step 6: 添加侧边栏样式**

在 `src/sidepanel/panel.css` 的文章信息区后加入：

```css
.article-note { display: flex; flex-direction: column; gap: 6px; }
.article-note textarea {
  box-sizing: border-box; width: 100%; min-height: 88px; resize: vertical;
  padding: 8px 9px; border: 1px solid var(--line-2); border-radius: 7px;
  background: var(--sunk); color: var(--ink); font: 12px/1.55 inherit;
}
.article-note textarea:focus { outline: 2px solid var(--ink); outline-offset: -1px; border-color: transparent; }
.article-note textarea:disabled { opacity: .6; cursor: default; }
.article-note-actions { display: flex; justify-content: flex-end; gap: 6px; }
.article-note-actions .btn { width: auto; }
```

- [ ] **Step 7: 运行侧边栏相关测试**

Run: `npx vitest run tests/sidepanel/article-note.test.ts tests/sidepanel/delete-ui.test.ts tests/sidepanel/note-view.test.ts`

Expected: PASS，新增编辑器行为和既有归档结果/删除入口均通过。

- [ ] **Step 8: 提交侧边栏功能**

```bash
git add src/sidepanel/useArticleNote.ts src/sidepanel/components/ArticleNoteEditor.tsx src/sidepanel/components/NoteView.tsx src/sidepanel/App.tsx src/sidepanel/panel.css tests/sidepanel/article-note.test.ts tests/sidepanel/delete-ui.test.ts
git commit -m "feat: 在侧边栏编辑文章 Note"
```

---

### Task 5: 在浏览页详情中按需读取和编辑 Note

**Files:**
- Create: `src/browser/components/AnnotationBlock.tsx`
- Create: `tests/browser/annotation-block.test.ts`
- Modify: `src/browser/components/DetailPane.tsx`
- Modify: `src/browser/components/DeleteBlock.tsx`
- Modify: `tests/browser/delete-block.test.ts`
- Modify: `src/browser/browser.css`

- [ ] **Step 1: 写失败的浏览页编辑测试**

创建 `tests/browser/annotation-block.test.ts`：

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { readArticleNote, writeArticleNote } from '../../src/core/article-note';
import { AnnotationBlock } from '../../src/browser/components/AnnotationBlock';

afterEach(cleanup);

const noteRef = { noteId: '6a030b860000000036000201', datasetPath: 'collected' };
const DIR = `collected/${noteRef.noteId}`;

describe('AnnotationBlock', () => {
  it('文件不存在时显示空状态，添加后写入磁盘', async () => {
    const store = createStore(memRoot());
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '浏览页添加' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('浏览页添加')).toBeTruthy());
    expect(screen.getByText('Note 已保存')).toBeTruthy();
    expect(await readArticleNote(store, DIR)).toBe('浏览页添加');
  });

  it('展示已有多行内容，取消恢复已保存内容', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '第一行\n第二行');
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText(/第一行/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '临时修改' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText(/第一行/)).toBeTruthy();
    expect(await readArticleNote(store, DIR)).toBe('第一行\n第二行');
  });

  it('清空保存时删除文件', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '待清空');
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    expect(await store.exists(`${DIR}/annotation.txt`)).toBe(false);
  });

  it('保存失败时保留输入和编辑状态，并通知上层 busy 已结束', async () => {
    const base = createStore(memRoot());
    const store: Store = { ...base, writeFile: async () => { throw new Error('save boom'); } };
    const onSavingChange = vi.fn();
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '不能丢' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText(/save boom/)).toBeTruthy());
    expect(screen.getByDisplayValue('不能丢')).toBeTruthy();
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it('读取失败不显示成空 Note，并允许重试', async () => {
    let broken = true;
    const base = createStore(memRoot());
    const store: Store = {
      ...base,
      readText: async (path) => {
        if (broken && path.endsWith('annotation.txt')) throw new Error('read boom');
        return base.readText(path);
      },
    };
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText(/read boom/)).toBeTruthy());
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
  });

  it('删除写盘期间禁用添加入口', async () => {
    const store = createStore(memRoot());
    render(createElement(AnnotationBlock, {
      store, noteRef, disabled: true, onSavingChange: vi.fn(),
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: '添加' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '添加' }).hasAttribute('disabled')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行新测试确认红灯**

Run: `npx vitest run tests/browser/annotation-block.test.ts`

Expected: FAIL，提示 `AnnotationBlock` 模块不存在。

- [ ] **Step 3: 实现按详情生命周期读取的 AnnotationBlock**

创建 `src/browser/components/AnnotationBlock.tsx`。状态机固定为 `loading | error | ready`，`ready` 下再区分 `editing/saving`：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { readArticleNote, writeArticleNote } from '../../core/article-note';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { Store } from '../../core/store';

export function AnnotationBlock({
  store, noteRef, disabled, onSavingChange,
}: {
  store: Store;
  noteRef: NoteRef;
  disabled: boolean;
  onSavingChange(saving: boolean): void;
}) {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = noteKeyOf(noteRef);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEditing(false);
    setLoadError(null);
    setSaveError(null);
    setNotice(null);
    void readArticleNote(store, key).then(
      (text) => {
        if (!alive) return;
        setSaved(text); setDraft(text); setLoading(false);
      },
      (reason) => {
        if (!alive) return;
        setLoadError(`Note 读取失败：${reason instanceof Error ? reason.message : String(reason)}`);
        setLoading(false);
      },
    );
    return () => { alive = false; };
  }, [store, key, retry]);

  const save = useCallback(async () => {
    setSaving(true); setSaveError(null); setNotice(null); onSavingChange(true);
    try {
      await writeArticleNote(store, key, draft);
      setSaved(draft); setEditing(false); setNotice('Note 已保存');
    } catch (reason) {
      setSaveError(`Note 保存失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setSaving(false); onSavingChange(false);
    }
  }, [store, key, draft, onSavingChange]);

  if (loading) return <section className="bw-annotation"><p className="bw-dim">正在读取 Note…</p></section>;
  if (loadError) return (
    <section className="bw-annotation">
      <p className="bw-note bad">{loadError}</p>
      <button className="bw-btn" onClick={() => setRetry((n) => n + 1)}>重试</button>
    </section>
  );
  if (editing) return (
    <section className="bw-annotation">
      <header><strong>Note</strong></header>
      <textarea aria-label="Note（可选）" value={draft} disabled={saving || disabled} onChange={(e) => setDraft(e.target.value)} />
      {saveError && <p className="bw-note bad">{saveError}</p>}
      <div className="bw-annotation-actions">
        <button className="bw-btn" disabled={saving} onClick={() => { setDraft(saved); setEditing(false); setSaveError(null); }}>取消</button>
        <button className="bw-btn primary" disabled={saving || disabled || draft === saved} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </section>
  );
  return (
    <section className="bw-annotation">
      <header><strong>Note</strong></header>
      {saved ? <p className="bw-annotation-text">{saved}</p> : <p className="bw-dim">暂无 Note</p>}
      {notice && <p className="bw-dim">{notice}</p>}
      <button className="bw-btn" disabled={disabled} onClick={() => { setNotice(null); setEditing(true); }}>{saved ? '编辑' : '添加'}</button>
    </section>
  );
}
```

- [ ] **Step 4: 挂入 DetailPane 并在保存期间禁用删除**

在 `src/browser/components/DetailPane.tsx`：

```tsx
import { AnnotationBlock } from './AnnotationBlock';

const [annotationSaving, setAnnotationSaving] = useState(false);
const [deleteBusy, setDeleteBusy] = useState(false);
```

把删除块改为：

```tsx
<DeleteBlock
  store={store}
  noteRef={noteRef}
  disabled={annotationSaving}
  onBusyChange={setDeleteBusy}
  onDeleted={onDeleted}
/>
```

在正文、tags 之后和 `AuthorBlock` 之前加入：

```tsx
<AnnotationBlock
  key={key}
  store={store}
  noteRef={noteRef}
  disabled={deleteBusy}
  onSavingChange={setAnnotationSaving}
/>
```

在 `src/browser/components/DeleteBlock.tsx` 把组件签名扩展为：

```tsx
export function DeleteBlock({
  store, noteRef, disabled = false, onBusyChange = () => undefined, onDeleted,
}: {
  store: Store;
  noteRef: NoteRef;
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
  onDeleted(): void;
}) {
```

把现有 `confirm()` 的 `deleteNote()` 调用包在以下结构中，原有权限错误和一般错误文案
留在 `catch` 内：

```ts
async function confirm(plan: DeletePlan) {
  setPhase({ kind: 'deleting', plan });
  onBusyChange(true);
  try {
    await deleteNote(store, plan);
  } catch (e) {
    if (isPermissionError(e)) {
      setPhase({ kind: 'error', text: '授权已失效。请重新加载本页并重新授权后再试。' });
      return;
    }
    setPhase({
      kind: 'error',
      text: `删除失败：${message(e)}。索引指针可能已删除，数据目录可能有残留。`,
    });
    return;
  } finally {
    onBusyChange(false);
  }
  setPhase({ kind: 'idle' });
  onDeleted();
}
```

让“删除这篇”和“确认删除”按钮使用
`disabled={busy || disabled}`；取消按钮保持可用。

在 `tests/browser/delete-block.test.ts` 增加：

```ts
it('外部写入进行中时删除入口禁用', async () => {
  render(createElement(DeleteBlock, {
    store: await seeded(), noteRef, disabled: true, onDeleted: vi.fn(),
  }));
  expect(screen.getByRole('button', { name: '删除这篇' }).hasAttribute('disabled')).toBe(true);
});

it('真正删除期间通知详情栏禁用 Note 写入', async () => {
  const onBusyChange = vi.fn();
  render(createElement(DeleteBlock, {
    store: await seeded(), noteRef, onBusyChange, onDeleted: vi.fn(),
  }));
  fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith(true));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});
```

- [ ] **Step 5: 添加浏览页样式**

在 `src/browser/browser.css` 详情栏样式区域加入：

```css
.bw-annotation {
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  padding: 12px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface);
}
.bw-annotation header { display: flex; width: 100%; align-items: center; }
.bw-annotation-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.bw-annotation textarea {
  box-sizing: border-box; width: 100%; min-height: 112px; resize: vertical;
  padding: 8px 10px; border: 1px solid var(--line-2); border-radius: 6px;
  background: var(--sunk); color: var(--ink); font: inherit;
}
.bw-annotation-actions { display: flex; align-self: flex-end; gap: 6px; }
.bw-btn.primary { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.bw-btn.primary:hover { opacity: .88; background: var(--ink); color: var(--paper); }
```

- [ ] **Step 6: 运行浏览页相关测试**

Run: `npx vitest run tests/browser/annotation-block.test.ts tests/browser/detail-pane.test.ts tests/browser/delete-block.test.ts tests/core/browse/search.test.ts`

Expected: PASS；搜索测试继续只覆盖标题、正文、标签等既有字段，没有 annotation 读取。

- [ ] **Step 7: 提交浏览页功能**

```bash
git add src/browser/components/AnnotationBlock.tsx src/browser/components/DetailPane.tsx src/browser/components/DeleteBlock.tsx src/browser/browser.css tests/browser/annotation-block.test.ts tests/browser/delete-block.test.ts
git commit -m "feat: 在浏览页编辑文章 Note"
```

---

### Task 6: 更新仓库说明和长期行为约束

**Files:**
- Modify: `README.md`
- Modify: `src/core/repo-template.ts`
- Modify: `tests/core/repo-template.test.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 先写生成仓库 README 的失败测试**

在 `tests/core/repo-template.test.ts` 增加：

```ts
it('README 说明 annotation.txt 是可选的文章级人工 Note', async () => {
  await ensureRepoTemplates(store);
  const txt = (await store.readText('README.md'))!;
  expect(txt).toContain('annotation.txt');
  expect(txt).toContain('文章级');
  expect(txt).toContain('更新、接管和迁移');
});
```

- [ ] **Step 2: 运行测试确认模板尚未说明 annotation**

Run: `npx vitest run tests/core/repo-template.test.ts`

Expected: FAIL，`README.md` 模板不包含 `annotation.txt`。

- [ ] **Step 3: 更新项目 README 和数据仓库模板**

在 `README.md` 的功能描述加入“可选的文章级人工 Note”，目录示例在 `note.json` 后加入：

```text
├── annotation.txt                   可选，文章级人工 Note
```

并用一段话说明：

```markdown
`annotation.txt` 是采集者对文章补充的多行纯文本 Note，属于文章而不是某个采集者。
重采、接管和迁移默认保留它；只有在侧边栏或浏览页主动修改或清空时才改变。
它不参与当前的搜索、筛选和排序。
```

在 `src/core/repo-template.ts` 的 `README` 模板目录树和正文加入同样语义。不要给 `annotation.txt` 添加 `-merge`：它是普通纯文本，应保留 Git 的逐行 diff/merge 能力。

- [ ] **Step 4: 更新 CLAUDE.md 的现状和决策表**

在 `CLAUDE.md` 的现状增加：

```markdown
- **文章级人工 Note**：采集时可填多行纯文本，落在文章目录的可选 `annotation.txt`；
  侧边栏和浏览页都能后续修改。更新、接管和迁移默认保留，主动清空才删除文件。
  Note 当前不参与搜索、筛选和排序。设计见
  `docs/superpowers/specs/2026-08-11-article-note-design.md`
```

在“已定的决策”表加入：

```markdown
| 人工 Note 独立保存为可选 `annotation.txt`，属于文章 | 不要放进 `note.json`，不要按采集者拆分，也不要让重采自动覆盖 |
```

真实浏览器测试由使用者最后执行。在使用者回报验收结果前，不得把这些行为写进“实测硬事实”。

- [ ] **Step 5: 运行模板测试和文档差异检查**

Run: `npx vitest run tests/core/repo-template.test.ts`

Expected: PASS。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 6: 提交文档同步**

```bash
git add README.md src/core/repo-template.ts tests/core/repo-template.test.ts CLAUDE.md
git commit -m "docs: 说明文章 Note 数据约定"
```

---

### Task 7: 全量自动验证与浏览器验收交接

**Files:**
- Verify only; no planned file changes

- [ ] **Step 1: 运行全仓测试**

Run: `npm test`

Expected: PASS，所有 Vitest 测试通过，无未处理 rejection 或 React `act(...)` 警告。

- [ ] **Step 2: 运行独立类型检查**

Run: `npx tsc --noEmit`

Expected: PASS，退出码 0。Vitest 和 Vite build 都不能替代这一步。

- [ ] **Step 3: 构建扩展**

Run: `npm run build`

Expected: PASS，Vite/CRXJS 成功产出 `dist/`，没有缺失导入或 CSS 构建错误。

- [ ] **Step 4: 检查计划外改动和提交边界**

Run: `git status --short`

Expected: 只保留使用者原有的未跟踪 `.DS_Store`、`.claude/`；功能与文档文件均已提交。

Run: `git log --oneline --decorate -8`

Expected: 能看到本计划中按核心存储、归档、侧边栏、浏览页、文档拆分的提交。

- [ ] **Step 5: 向使用者交接真实浏览器验收清单**

不要替使用者宣称真实浏览器验收通过。交接以下项目，并等待使用者实际执行后反馈：

1. 首次采集填写/留空 Note。
2. 原位更新未编辑时保留 Note。
3. 侧边栏独立添加、修改、清空及失败重试。
4. 浏览页独立添加、修改、清空及失败重试。
5. 接管继承 Note。
6. 迁移复制或采用本次编辑值，并删除旧目录。
7. 权限失效、仓库目录消失时内容不丢且提示正确。
8. 磁盘直接修改 `annotation.txt` 后重新打开读取最新值。

---

## 实施注意事项

- 严格保持 `noteText` 三态：`undefined` 是“未编辑/保留”，`''` 是“主动清空”。任何 UI 默认值都不能破坏这个差异。
- `annotation.txt` 写入必须早于新指针、接管旧指针删除和迁移旧目录删除。
- 浏览页不得把 annotation 塞进 `RowMeta`；否则会让列表扫描每篇多一次文件读取，并意外改变搜索范围。
- 独立保存 Note 不得调用 `archive()`，也不得修改 `note.json`、指针或归档计数。
- 删除整篇文章继续依赖现有递归删目录行为，不为 annotation 增加第二套删除索引。
- 不新增 Markdown、字数上限、审计元数据、实时文件监听或持久草稿，这些都在本次范围外。
- 实现完成后必须使用 `superpowers:verification-before-completion` 的证据要求再报告成功。
