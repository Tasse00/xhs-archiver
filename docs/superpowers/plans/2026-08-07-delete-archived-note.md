# 删除已采集的笔记 —— 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让使用者在侧边栏和浏览页各点一个按钮，就能把一篇采错的笔记连同它的全部索引指针一起删干净，不再需要手动去仓库里删两处。

**Architecture:** 新增核心模块 `src/core/delete.ts`，把删除拆成「先算计划、再执行」两步——`planDelete` 只读、产出确认清单，`deleteNote` 按「先指针后目录」的顺序执行。两个界面共用这一对函数，各自渲染自己的内联确认块。浏览页的定位从「只读浏览器」改成「管理中心」，因此拿完整 `Store`；`src/core/browse/*` 仍只收 `ReadStore`。

**Tech Stack:** TypeScript、React 19、Vitest 3、@testing-library/react（jsdom）、File System Access API。

## Global Constraints

这些是项目级约定，每个任务都隐含包含，逐条照做：

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。每个任务都是这个结构。
- **测试文件只能是 `.ts`**，不能是 `.tsx`——`vitest.config.ts` 的 `include` 是 `tests/**/*.test.ts`。React 组件测试一律用 `createElement`，不写 JSX。
- **需要 DOM 的测试文件第一行写 `// @vitest-environment jsdom`**，并在文件里 `afterEach(cleanup)`。默认环境是 node。
- **`src/core/` 下的代码不碰 DOM，也不碰 `chrome.*`**。所有外部依赖通过参数注入。碰 `chrome.*` 的代码只出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **代码注释用中文，写「为什么」而不是「做了什么」。**
- **改了行为就在同一个 commit 里同步改文档。**
- 跑测试：`npx vitest run`。跑单个文件：`npx vitest run tests/core/delete.test.ts`。构建：`npm run build`。
- 提交信息用中文，`<type>: <说明>`，结尾附：
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- 设计文档是 `docs/superpowers/specs/2026-08-07-delete-archived-note-design.md`，有分歧以它为准。
- 全程使用的固定测试数据：note id `6a030b860000000036000201`（bucket 是 `6a`），指针目录 `_index/6a/6a030b860000000036000201`。

## 文件结构

| 文件 | 状态 | 职责 |
|---|---|---|
| `src/core/delete.ts` | 新建 | `planDelete` / `deleteNote` / `removeEmptyDir` / `removeEmptyParent`。删除的全部规则只在这里 |
| `src/core/index-store.ts` | 改 | `lookup` 签名放宽到 `ReadStore`；新增 `bucketDir` |
| `src/core/browse/quality.ts` | 改 | 删掉重复的 `readPointers`，改用 `lookup` |
| `src/core/browse/scope.ts` | 改 | 新增纯函数 `dropNote`，从树里摘掉一篇 |
| `src/core/archiver.ts` | 改 | `removeEmptyParent` 改为从 `delete.ts` 引入 |
| `src/core/read-store.ts` | 改 | 删掉不再有调用方的 `toReadStore` |
| `src/sidepanel/components/Actions.tsx` | 改 | 新增 `DeleteAction`（按钮 + 内联确认块） |
| `src/sidepanel/components/NoteView.tsx` | 改 | 接上 `DeleteAction`，新增 `DeleteResult` 结果卡 |
| `src/sidepanel/App.tsx` | 改 | 删除流程接线 |
| `src/sidepanel/panel.css` | 改 | 危险色按钮与确认块样式 |
| `src/browser/components/DeleteBlock.tsx` | 新建 | 浏览页的删除按钮 + 确认块，自带 plan/error 状态 |
| `src/browser/components/DetailPane.tsx` | 改 | 收完整 `Store`，挂上 `DeleteBlock` |
| `src/browser/components/PermissionGate.tsx` | 改 | 改申请 `readwrite` |
| `src/browser/hooks/useScope.ts` | 改 | 新增 `removeNote`、暴露 `gen` |
| `src/browser/hooks/useRows.ts` | 改 | 缓存失效改由显式 `epoch` 触发，删一行不再清空整块缓存 |
| `src/browser/App.tsx` | 改 | 保留完整 `Store`、删除后的列表/详情栏/提示条反应 |
| `src/browser/browser.css` | 改 | 确认块与提示条样式 |
| `tests/core/delete.test.ts` | 新建 | `planDelete` / `deleteNote` |
| `tests/core/browse/scope.test.ts` | 改（已存在则追加） | `dropNote` |
| `tests/core/index-store.test.ts` | 改 | `lookup` 只用 `ReadStore` 也能跑 |
| `tests/sidepanel/delete-ui.test.ts` | 新建 | `DeleteAction` / `DeleteResult` |
| `tests/browser/delete-block.test.ts` | 新建 | `DeleteBlock` |

---

### Task 1: `lookup` 放宽到 `ReadStore`，消掉 `quality.ts` 里的重复实现

`index-store.lookup` 目前用 `store.listDir`，因此要求完整 `Store`。`quality.ts` 只好自己重写一份只读版，那里留着一句「代价是十来行重复」的注释。`planDelete` 只读，需要的正是一个收 `ReadStore` 的 `lookup`——先把这层理顺，后面两个任务才不用造第三份。

**Files:**
- Modify: `src/core/index-store.ts`
- Modify: `src/core/browse/quality.ts:22-40`（删掉 `readPointers`）
- Test: `tests/core/index-store.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `lookup(store: ReadStore, noteId: string): Promise<Pointer[]>`（签名放宽，行为不变）
  - `bucketDir(noteId: string): string` → `_index/<前两位>`

- [ ] **Step 1: 写失败的测试**

在 `tests/core/index-store.test.ts` 顶部的 import 里加上 `ReadStore` 类型：

```ts
import type { ReadStore } from '../../src/core/read-store';
```

在 `describe('lookup', ...)` 块的末尾（`});` 之前）追加：

```ts
  // 浏览页与 planDelete 都只有 ReadStore。用 listDir 实现的话这条会编译不过，
  // 这个测试就是防止哪天有人图省事改回去。
  it('只用 ReadStore 的四个方法就能查', async () => {
    await writePointer(store, p('zach', 'collected/2026-08-03/6a030b860000000036000201'));
    const ro: ReadStore = {
      readText: (path) => store.readText(path),
      readFile: (path) => store.readFile(path),
      exists: (path) => store.exists(path),
      listEntries: (path) => store.listEntries(path),
    };
    const got = await lookup(ro, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
  });
```

在 `describe('路径规则', ...)` 里追加一条：

```ts
  it('桶目录', () => expect(bucketDir('6a030b86')).toBe('_index/6a'));
```

并把文件顶部那行 import 改成：

```ts
import { bucketOf, bucketDir, pointerDir, pointerPath, lookup, writePointer, removePointer } from '../../src/core/index-store';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/index-store.test.ts`
Expected: FAIL —— `bucketDir is not a function`，以及 `store.listDir is not a function`（vitest 用 esbuild 剥类型、不做类型检查，所以这条是运行时炸的，正好说明 `lookup` 现在确实在用 `listDir`）。

- [ ] **Step 3: 实现**

`src/core/index-store.ts` 的开头 import 改成：

```ts
import type { Pointer } from '../types';
import type { ReadStore } from './read-store';
import type { Store } from './store';
import { serializePointer } from './serialize';
```

在 `pointerDir` 之前加：

```ts
export function bucketDir(noteId: string): string {
  return `${INDEX_ROOT}/${bucketOf(noteId)}`;
}
```

把 `pointerDir` 改成复用它：

```ts
export function pointerDir(noteId: string): string {
  return `${bucketDir(noteId)}/${noteId}`;
}
```

把 `lookup` 整个替换成（用 `listEntries` 代替 `listDir`，因此只需要 `ReadStore`）：

```ts
/**
 * 返回该笔记的全部指针。长度 > 1 说明发生了并发采集竞态
 * （多人各自未 pull 就采了同一篇），需人工清理。
 *
 * 只收 ReadStore：查指针是纯读操作，浏览页的质量检查和删除计划都要用它，
 * 收完整 Store 会逼着只读的调用方各自再抄一份。
 */
export async function lookup(store: ReadStore, noteId: string): Promise<Pointer[]> {
  const dir = pointerDir(noteId);
  const out: Pointer[] = [];
  for (const e of await store.listEntries(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const txt = await store.readText(`${dir}/${e.name}`);
    if (txt === null) continue;
    try {
      out.push(JSON.parse(txt) as Pointer);
    } catch {
      // 损坏的指针不应让整个查重失败
    }
  }
  return out;
}
```

`src/core/browse/quality.ts`：把顶部的

```ts
import { pointerDir } from '../index-store';
```

改成

```ts
import { lookup } from '../index-store';
```

删掉整个 `readPointers` 函数（连同它上面那段「代价是十来行重复」的注释），并把 `checkQuality` 里的

```ts
  const pointers = await readPointers(store, ref.noteId);
```

改成

```ts
  const pointers = await lookup(store, ref.noteId);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run`
Expected: PASS，全部测试文件通过（`quality` 相关的既有测试也要照常绿）。

- [ ] **Step 5: 提交**

```bash
git add src/core/index-store.ts src/core/browse/quality.ts tests/core/index-store.test.ts
git commit -m "$(cat <<'EOF'
refactor: lookup 放宽到 ReadStore，消掉质量检查里的重复实现

planDelete 与浏览页都只有 ReadStore。lookup 改用 listEntries 后不再需要
完整 Store，quality.ts 里那份「代价是十来行重复」的只读版可以直接删掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `planDelete` —— 算出要删什么

确认清单要显示的正是将删的东西。让界面自己去凑这份清单等于把删除范围的定义抄两遍，两边迟早不一致。所以先做「算计划」这一半，它是纯读操作，能独立测透。

**Files:**
- Create: `src/core/delete.ts`
- Test: `tests/core/delete.test.ts`

**Interfaces:**
- Consumes: `lookup(store: ReadStore, noteId: string): Promise<Pointer[]>`（Task 1）
- Produces:
  - `interface DeletePlan { noteId: string; dirs: string[]; pointers: Pointer[] }`
  - `planDelete(store: ReadStore, noteId: string, here?: string): Promise<DeletePlan>`

- [ ] **Step 1: 写失败的测试**

创建 `tests/core/delete.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import { planDelete } from '../../src/core/delete';
import type { Pointer } from '../../src/types';

const NOTE = '6a030b860000000036000201';

const p = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('planDelete', () => {
  it('没有指针、只有一份孤儿目录时，计划里只有那个目录', async () => {
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    const plan = await planDelete(store, NOTE, `collected/2026-08-03/${NOTE}`);
    expect(plan.noteId).toBe(NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers).toEqual([]);
  });

  it('单指针单目录：各一条', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers.map((x) => x.collector)).toEqual(['zach']);
  });

  // 同一份数据被两个人各登记了一次（race_same_path）。目录只能删一次。
  it('同目录下多个采集者的指针：目录去重成一个', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await writePointer(store, p('alice', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers.map((x) => x.collector).sort()).toEqual(['alice', 'zach']);
  });

  // race_diverged：两个人各存各的。「删掉这篇的所有痕迹」意味着两份都删。
  it('指针指向两个不同目录：两个目录都进计划', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await writePointer(store, p('alice', `alice/2026-08-01/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`alice/2026-08-01/${NOTE}`, `collected/2026-08-03/${NOTE}`]);
  });

  // 使用者手动删了目录却没删指针——这正是本功能要收拾的局面。
  it('指针指向的目录已经不存在时，仍然进计划', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
  });

  it('here 与指针指向的目录相同时不重复计入', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE, `collected/2026-08-03/${NOTE}`);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
  });

  it('什么都没有时计划为空', async () => {
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([]);
    expect(plan.pointers).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/delete.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/core/delete"`。

- [ ] **Step 3: 实现**

创建 `src/core/delete.ts`：

```ts
import type { Pointer } from '../types';
import type { ReadStore } from './read-store';
import { lookup } from './index-store';

export interface DeletePlan {
  noteId: string;
  /** 将被删除的笔记目录，去重后按字典序排。 */
  dirs: string[];
  /** 将被删除的指针。 */
  pointers: Pointer[];
}

/**
 * 算出删掉这篇要动哪些东西。只读，产物既是给人看的确认清单，也是 deleteNote
 * 的唯一输入——看到的就是删掉的，界面不必自己再拼一遍范围定义。
 *
 * `here` 是浏览页当前正在看的那份目录。它可能是一份没有指针的孤儿副本，
 * 光靠指针查不出来。侧边栏不传：它只知道指针，也不该为此扫全仓库。
 */
export async function planDelete(
  store: ReadStore,
  noteId: string,
  here?: string,
): Promise<DeletePlan> {
  const pointers = await lookup(store, noteId);
  const dirs = new Set(pointers.map((p) => p.path));
  if (here) dirs.add(here);
  return { noteId, dirs: [...dirs].sort(), pointers };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/delete.test.ts`
Expected: PASS，7 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/core/delete.ts tests/core/delete.test.ts
git commit -m "$(cat <<'EOF'
feat: 新增 planDelete，算出删一篇笔记要动哪些目录与指针

按 note_id 收全部指针，加上调用方传入的当前目录（可能是没指针的孤儿副本），
目录去重后排序。产物同时是确认清单和执行输入，界面不必自己拼范围。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `deleteNote` —— 先删指针，再删目录

这是整个功能里最要紧的一条。中断时的残留必须落在安全的那一侧：先删指针最坏留下**孤儿目录**（`quality.ts` 的 `no_pointer` 看得见，不影响查重）；先删目录最坏留下**孤儿指针**，那会破坏「指针存在 ⟹ 数据完整」，污染所有人的查重——正是本功能要消灭的问题。

顺便把 `archiver.ts` 里的 `removeEmptyParent` 提到这里共用：同一条「清理空父目录但不上溯到根」的规则不该有两份实现。

**Files:**
- Modify: `src/core/delete.ts`
- Modify: `src/core/archiver.ts:21`（import）、`src/core/archiver.ts:301-307`（删掉本地的 `removeEmptyParent`）
- Test: `tests/core/delete.test.ts`

**Interfaces:**
- Consumes: `DeletePlan`、`planDelete`（Task 2）；`bucketDir` / `pointerDir` / `removePointer`（Task 1 与既有）
- Produces:
  - `interface DeleteResult { dirs: number; pointers: number }`
  - `deleteNote(store: Store, plan: DeletePlan): Promise<DeleteResult>`
  - `removeEmptyDir(store: Store, path: string): Promise<void>`
  - `removeEmptyParent(store: Store, path: string): Promise<void>`

- [ ] **Step 1: 写失败的测试**

在 `tests/core/delete.test.ts` 的 import 里补上：

```ts
import { deleteNote, planDelete } from '../../src/core/delete';
import { lookup } from '../../src/core/index-store';
```

（把原来那行只 import `planDelete` 的替换掉。）

在文件末尾追加：

```ts
describe('deleteNote', () => {
  it('指针和数据目录都不见了', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');

    const res = await deleteNote(store, await planDelete(store, NOTE));

    expect(res).toEqual({ dirs: 1, pointers: 1 });
    expect(await lookup(store, NOTE)).toEqual([]);
    expect(await store.exists(`collected/2026-08-03/${NOTE}/note.json`)).toBe(false);
  });

  // 空的指针目录和空的桶目录留着只会让 _index 越堆越脏
  it('清空后的指针目录与桶目录一并删掉', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`_index/6a/${NOTE}`)).toBe(false);
    expect(await store.exists('_index/6a')).toBe(false);
  });

  it('桶目录下还有别的笔记时，桶目录保留', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile('_index/6a/6a99999999999999999999zz/zach.json', '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`_index/6a/${NOTE}`)).toBe(false);
    expect(await store.exists('_index/6a')).toBe(true);
  });

  it('父目录因此变空就删掉', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists('collected/2026-08-03')).toBe(false);
  });

  it('父目录下还有别的笔记就保留', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    await store.writeFile('collected/2026-08-03/6a99999999999999999999zz/note.json', '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists('collected/2026-08-03')).toBe(true);
  });

  // 写入路径设成 collected 时，笔记目录的父就是 collected 本身。
  // 删空它没有意义，下次采集还得重建。
  it('路径只有两段时不动父目录', async () => {
    await writePointer(store, p('zach', `collected/${NOTE}`));
    await store.writeFile(`collected/${NOTE}/note.json`, '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`collected/${NOTE}`)).toBe(false);
    expect(await store.exists('collected')).toBe(true);
  });

  /**
   * 顺序断言。删目录那一步炸掉时，残留必须是「孤儿目录」——它安全，查重不受
   * 影响。反过来先删目录再删指针的话，同样的中断会留下孤儿指针，破坏
   * 「指针存在 ⟹ 数据完整」，让所有人都放弃采集一篇其实不存在的笔记。
   */
  it('删目录中途失败时，指针已经删掉，残留的是孤儿目录', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    const plan = await planDelete(store, NOTE);

    const failing: Store = {
      ...store,
      removeDir: async (path: string) => {
        if (path.startsWith('collected')) throw new Error('boom');
        return store.removeDir(path);
      },
    };

    await expect(deleteNote(failing, plan)).rejects.toThrow('boom');
    expect(await lookup(store, NOTE)).toEqual([]);
    expect(await store.exists(`collected/2026-08-03/${NOTE}/note.json`)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/delete.test.ts`
Expected: FAIL —— `deleteNote is not a function`（7 个新测试全红，Task 2 的 7 个仍绿）。

- [ ] **Step 3: 实现**

`src/core/delete.ts` 顶部 import 改成：

```ts
import type { Pointer } from '../types';
import type { ReadStore } from './read-store';
import type { Store } from './store';
import { bucketDir, lookup, pointerDir, removePointer } from './index-store';
```

在文件末尾追加：

```ts
export interface DeleteResult {
  dirs: number;
  pointers: number;
}

/** 目录为空才删。这是仓库的本地单人操作，空判定与删除之间不需要原子性。 */
export async function removeEmptyDir(store: Store, path: string): Promise<void> {
  if ((await store.listDir(path)).length === 0) await store.removeDir(path);
}

/**
 * 清理因删除而变空的父目录，但绝不上溯到仓库根：路径不足三段就不动。
 *
 * 守卫的用处：写入路径被设成 `collected` 这种两段路径时，笔记目录的父级就是
 * `collected/` 本身，删空它没有意义，下次采集还得重建。
 */
export async function removeEmptyParent(store: Store, path: string): Promise<void> {
  const parts = path.split('/');
  if (parts.length < 3) return;
  await removeEmptyDir(store, parts.slice(0, -1).join('/'));
}

/**
 * 执行删除。**先删指针，再删数据目录**——这是 archive() 「先写数据、后写指针」
 * 的镜像，理由相同：中断时的残留必须落在安全的那一侧。
 *
 * 先指针后目录，最坏留下孤儿目录：quality.ts 的 no_pointer 认得它，查重不受
 * 影响，重采会直接覆盖。反过来最坏留下孤儿指针，那会破坏「指针存在 ⟹ 数据
 * 完整」这条全局不变量，所有人的查重都会拿到假阳性——正是本功能要消灭的问题。
 * 不对称得很明显，没有权衡余地。
 */
export async function deleteNote(store: Store, plan: DeletePlan): Promise<DeleteResult> {
  for (const p of plan.pointers) {
    await removePointer(store, plan.noteId, p.collector);
  }
  await removeEmptyDir(store, pointerDir(plan.noteId));
  await removeEmptyDir(store, bucketDir(plan.noteId));

  for (const dir of plan.dirs) {
    await store.removeDir(dir);
  }
  for (const dir of plan.dirs) {
    await removeEmptyParent(store, dir);
  }

  return { dirs: plan.dirs.length, pointers: plan.pointers.length };
}
```

`src/core/archiver.ts`：把第 21 行的 import 下面补一行

```ts
import { removeEmptyParent } from './delete';
```

并删掉文件末尾整个本地的 `removeEmptyParent` 函数（含它上面那行 `/** 迁移后清理因此变空的日期目录，但不删采集者目录。 */` 注释）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run`
Expected: PASS —— `tests/core/delete.test.ts` 14 个测试全过，`tests/core/archiver.test.ts` 里迁移相关的既有测试照常绿（证明抽出去的 `removeEmptyParent` 行为没变）。

- [ ] **Step 5: 提交**

```bash
git add src/core/delete.ts src/core/archiver.ts tests/core/delete.test.ts
git commit -m "$(cat <<'EOF'
feat: 新增 deleteNote，先删指针再删数据目录

顺序是 archive 的镜像：中断后的残留必须是孤儿目录而不是孤儿指针，后者会
破坏「指针存在 ⟹ 数据完整」，污染所有人的查重。顺带把 archiver 里的
removeEmptyParent 提到 delete.ts 共用，同一条规则不留两份实现。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 侧边栏的删除按钮与确认块（纯组件）

先把组件做出来并测透，接线留到下一个任务——组件不碰 `chrome.*`，能用 jsdom 直接点。

不用弹窗：侧边栏本来就窄，modal 在那里不好使；而清单是这个确认框存在的理由，`window.confirm` 显示不了清单。

**Files:**
- Modify: `src/sidepanel/components/Actions.tsx`
- Modify: `src/sidepanel/panel.css`
- Test: `tests/sidepanel/delete-ui.test.ts`（新建）

**Interfaces:**
- Consumes: `DeletePlan`（Task 2）
- Produces:
  ```ts
  function DeleteAction(props: {
    plan: DeletePlan | null;   // null = 确认块没打开
    busy: boolean;
    onOpen(): void;
    onCancel(): void;
    onConfirm(): void;
  }): JSX.Element
  ```

- [ ] **Step 1: 写失败的测试**

创建 `tests/sidepanel/delete-ui.test.ts`：

```ts
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeleteAction } from '../../src/sidepanel/components/Actions';
import type { DeletePlan } from '../../src/core/delete';
import type { Pointer } from '../../src/types';

afterEach(cleanup);

const NOTE = '6a030b860000000036000201';

const pointer = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

const plan: DeletePlan = {
  noteId: NOTE,
  dirs: [`collected/2026-08-03/${NOTE}`],
  pointers: [pointer('zach', `collected/2026-08-03/${NOTE}`)],
};

describe('DeleteAction', () => {
  it('没打开时只有一个入口按钮，不显示清单', () => {
    render(createElement(DeleteAction, {
      plan: null, busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '删除这篇' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
  });

  it('点入口通知上层去算计划', () => {
    const onOpen = vi.fn();
    render(createElement(DeleteAction, {
      plan: null, busy: false, onOpen, onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('采集进行中时入口禁用', () => {
    render(createElement(DeleteAction, {
      plan: null, busy: true, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '删除这篇' }).hasAttribute('disabled')).toBe(true);
  });

  // 「可能连带删掉别处那一份」这件事必须在按下去之前看得见
  it('打开后逐条列出将删的目录与指针', () => {
    render(createElement(DeleteAction, {
      plan: {
        noteId: NOTE,
        dirs: [`alice/2026-08-01/${NOTE}`, `collected/2026-08-03/${NOTE}`],
        pointers: [
          pointer('alice', `alice/2026-08-01/${NOTE}`),
          pointer('zach', `collected/2026-08-03/${NOTE}`),
        ],
      },
      busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByText(`alice/2026-08-01/${NOTE}/`)).toBeTruthy();
    expect(screen.getByText(`collected/2026-08-03/${NOTE}/`)).toBeTruthy();
    // getByText 匹配的是整个文本节点，所以前缀要一起写上
    expect(screen.getByText('索引指针：alice、zach')).toBeTruthy();
  });

  it('确认与取消各自回调，且不互相触发', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(createElement(DeleteAction, {
      plan, busy: false, onOpen: vi.fn(), onCancel, onConfirm,
    }));

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // 目录已被手动删过、只剩孤儿指针，是本功能最常见的入口场景
  it('没有目录只有指针时说明只清索引', () => {
    render(createElement(DeleteAction, {
      plan: { noteId: NOTE, dirs: [], pointers: [pointer('zach', `collected/${NOTE}`)] },
      busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByText('没有数据目录，只清理索引指针')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sidepanel/delete-ui.test.ts`
Expected: FAIL —— `DeleteAction` 不是 `Actions.tsx` 的导出。

- [ ] **Step 3: 实现**

`src/sidepanel/components/Actions.tsx` 顶部 import 补上：

```ts
import type { DeletePlan } from '../../core/delete';
```

在文件末尾追加：

```tsx
/**
 * 删除入口。确认块内联展开而不是弹 modal——侧边栏窄，modal 在这里不好使；
 * 而 window.confirm 显示不了清单，清单恰恰是这个确认框存在的理由：删除按
 * note_id 清全部痕迹，可能连带删掉别处那一份，这件事必须在按下去之前看得见。
 *
 * 计划由上层现算（要读盘），所以 plan 为 null 就表示还没打开。
 */
export function DeleteAction({
  plan, busy, onOpen, onCancel, onConfirm,
}: {
  plan: DeletePlan | null;
  busy: boolean;
  onOpen(): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  // 用 !plan 而不是 plan === null：vitest 不做类型检查，既有测试渲染 NoteView
  // 时漏传这个 prop 就会传进 undefined，严格比 null 会让它一头撞进下面的 plan.dirs
  if (!plan) {
    return (
      <button className="btn btn-sm btn-danger" disabled={busy} onClick={onOpen}>
        删除这篇
      </button>
    );
  }

  return (
    <div className="del-confirm">
      <div className="del-h">删除后不可撤销，恢复只能靠 git</div>
      <div className="del-list">
        {plan.dirs.length === 0 ? (
          <p className="hint">没有数据目录，只清理索引指针</p>
        ) : (
          plan.dirs.map((d) => <p className="mono" key={d}>{d}/</p>)
        )}
        {plan.pointers.length > 0 && (
          <p className="hint">索引指针：{plan.pointers.map((p) => p.collector).join('、')}</p>
        )}
      </div>
      <div className="del-acts">
        <button className="btn btn-sm" onClick={onCancel}>取消</button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={onConfirm}>确认删除</button>
      </div>
    </div>
  );
}
```

`src/sidepanel/panel.css`：在 `.act-warn` 那一段之后追加：

```css
/* 危险动作。红色只用来标它，不做主按钮——通篇红会让人分不清哪个才是要点的 */
.btn-danger { color: var(--accent); border-color: var(--line-2); background: var(--surface); }
.btn-danger:hover { border-color: var(--accent); background: var(--accent-w); }

.del-confirm {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--accent); border-radius: 8px; padding: 9px 10px;
  background: var(--accent-w);
}
.del-h { font-size: 12px; font-weight: 550; color: var(--accent); }
.del-list { display: flex; flex-direction: column; gap: 3px; }
.del-list p { margin: 0; font-size: 11.5px; word-break: break-all; }
.del-acts { display: flex; gap: 6px; }
.del-acts .btn { flex: 1; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/sidepanel/delete-ui.test.ts`
Expected: PASS，6 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/sidepanel/components/Actions.tsx src/sidepanel/panel.css tests/sidepanel/delete-ui.test.ts
git commit -m "$(cat <<'EOF'
feat: 侧边栏加删除按钮与内联确认块

确认块列出将删的目录与指针。用内联展开而不是 modal：侧边栏窄，而
window.confirm 显示不了清单——清单正是这个确认框存在的理由。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 侧边栏接线

把 `DeleteAction` 挂进 `NoteView`，在 `App` 里实现「算计划 → 确认 → 删除 → 重新判定 → 显示结果」。

入口只在存在指针的状态出现（`mine` / `others`）。`ready` 状态没有指针，没什么可删。

**Files:**
- Modify: `src/sidepanel/components/NoteView.tsx`
- Modify: `src/sidepanel/App.tsx`
- Test: `tests/sidepanel/delete-ui.test.ts`

**Interfaces:**
- Consumes: `DeleteAction`（Task 4）、`planDelete` / `deleteNote` / `DeletePlan` / `DeleteResult`（Task 2、3）
- Produces: `NoteView` 新增 5 个 props —— `deletePlan: DeletePlan | null`、`onOpenDelete(): void`、`onCancelDelete(): void`、`onConfirmDelete(): void`、`justDeleted: DeleteResult | null`；`NoteView.tsx` 导出 `DeleteResultCard`

- [ ] **Step 1: 写失败的测试**

在 `tests/sidepanel/delete-ui.test.ts` 的 import 里补上：

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { DeleteResultCard } from '../../src/sidepanel/components/NoteView';
import { NoteView } from '../../src/sidepanel/components/NoteView';
import type { ExtractedComments, ExtractedNote } from '../../src/types';
```

在文件末尾追加：

```ts
const comments: ExtractedComments = {
  declaredTotal: 0, collectedCount: 0, complete: true, hasMore: false, list: [],
};

const note = {
  noteId: NOTE,
  url: `https://www.xiaohongshu.com/explore/${NOTE}`,
  shareUrl: '',
  title: '一篇笔记',
  content: '正文',
  tags: [],
  publishedAt: '2026-08-01T10:00:00+08:00',
  lastEditedAt: '2026-08-01T10:00:00+08:00',
  author: { user_id: 'u1', nickname: '小红', avatar_url: '', profile_url: '' },
  interact: { liked: 1, collected: 1, comment: 0, share: 0 },
  images: [],
  raw: {},
} as unknown as ExtractedNote;

function noteViewProps(overrides: Record<string, unknown>) {
  return {
    state: { kind: 'mine', note, comments, pointer: pointer('zach', `collected/2026-08-03/${NOTE}`), duplicates: [] },
    collector: 'zach',
    datasetPath: 'collected/2026-08-03',
    onEditDatasetPath: vi.fn(),
    onArchive: vi.fn(),
    progress: null,
    message: null,
    justArchived: null,
    pageStep: null,
    deletePlan: null,
    onOpenDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    justDeleted: null,
    ...overrides,
  } as never;
}

describe('NoteView 里的删除入口', () => {
  it('自己采过时出现删除入口', () => {
    const html = renderToStaticMarkup(createElement(NoteView, noteViewProps({})));
    expect(html).toContain('删除这篇');
  });

  // 「无论是谁采集的」——别人采过的同样能删
  it('别人采过时也出现删除入口', () => {
    const html = renderToStaticMarkup(createElement(NoteView, noteViewProps({
      state: {
        kind: 'others', note, comments,
        pointers: [pointer('alice', `alice/2026-08-01/${NOTE}`)],
      },
    })));
    expect(html).toContain('删除这篇');
  });

  it('没人采过时没有删除入口', () => {
    const html = renderToStaticMarkup(createElement(NoteView, noteViewProps({
      state: { kind: 'ready', note, comments },
    })));
    expect(html).not.toContain('删除这篇');
  });

  it('采集进行中时不显示删除入口', () => {
    const html = renderToStaticMarkup(createElement(NoteView, noteViewProps({
      progress: { done: 1, total: 3 },
    })));
    expect(html).not.toContain('删除这篇');
  });
});

describe('DeleteResultCard', () => {
  it('说清删了几个目录几个指针', () => {
    const html = renderToStaticMarkup(
      createElement(DeleteResultCard, { result: { dirs: 2, pointers: 3 } }),
    );
    expect(html).toContain('已删除');
    expect(html).toContain('2 个目录');
    expect(html).toContain('3 个索引指针');
  });

  it('只清了指针时如实说', () => {
    const html = renderToStaticMarkup(
      createElement(DeleteResultCard, { result: { dirs: 0, pointers: 1 } }),
    );
    expect(html).toContain('只清理了索引指针');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/sidepanel/delete-ui.test.ts`
Expected: FAIL —— `DeleteResultCard` 不是导出；`NoteView` 渲染结果里没有「删除这篇」。

- [ ] **Step 3: 实现**

`src/sidepanel/components/NoteView.tsx`：

1）顶部 import 补上：

```ts
import type { DeletePlan, DeleteResult } from '../../core/delete';
```

并把 `ArchiveActions` 那行 import 改成：

```ts
import { ArchiveActions, DeleteAction, PathDisplay, type ArchiveMode } from './Actions';
```

2）在 `Result` 组件之后追加：

```tsx
/** 刚删完的结果卡。与采集结果卡同一位置、同一套样式，切换笔记后消失。 */
export function DeleteResultCard({ result }: { result: DeleteResult }) {
  return (
    <div className="result ok">
      <div className="result-h"><IconCheck />已删除</div>
      <dl>
        <dt>数据</dt>
        <dd>
          {result.dirs === 0 ? '只清理了索引指针，没有数据目录' : `${result.dirs} 个目录`}
        </dd>
        <dt>索引</dt><dd>{result.pointers} 个索引指针</dd>
      </dl>
      <div className="note">恢复只能靠 git —— 仓库里已经没有这篇了。</div>
    </div>
  );
}
```

3）`NoteView` 的参数列表与类型加上五个新 prop：

```tsx
export function NoteView({
  state, collector, datasetPath, onEditDatasetPath, onArchive, progress, message, justArchived, pageStep,
  deletePlan, onOpenDelete, onCancelDelete, onConfirmDelete, justDeleted,
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
  /** 删除确认块的内容。null 表示确认块没打开。 */
  deletePlan: DeletePlan | null;
  onOpenDelete(): void;
  onCancelDelete(): void;
  onConfirmDelete(): void;
  justDeleted: DeleteResult | null;
}) {
```

4）在现有的 `if (justArchived) { ... }` 整块之后、`const sameDir = ...` 之前插入：

```tsx
  // 刚删完，状态已经回到「可采集」。先说结果，否则界面看起来像什么都没发生
  if (justDeleted) {
    return idle(
      <div className="pt-body">
        <DeleteResultCard result={justDeleted} />
        <p className="hint">切换到别的笔记后这条提示会消失。</p>
        <NoteCard note={a.note} comments={a.comments} />
      </div>,
    );
  }
```

5）在底部动作区里，把现有的

```tsx
        ) : (
          <>
            <ArchiveActions
              existing={a.existing}
              datasetPath={datasetPath}
              collector={collector}
              busy={false}
              onArchive={onArchive}
            />
          </>
        )}
```

替换成

```tsx
        ) : (
          <>
            <ArchiveActions
              existing={a.existing}
              datasetPath={datasetPath}
              collector={collector}
              busy={false}
              onArchive={onArchive}
            />
            {/* 只在有指针时出现：没人采过的笔记没什么可删 */}
            {a.existing && (
              <DeleteAction
                plan={deletePlan}
                busy={false}
                onOpen={onOpenDelete}
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
              />
            )}
          </>
        )}
```

`src/sidepanel/App.tsx`：

1）import 补上：

```ts
import { deleteNote, planDelete, type DeletePlan, type DeleteResult } from '../core/delete';
```

2）在 `const [pageStep, setPageStep] = useState...` 后面加两个状态：

```ts
  // 删除确认块的内容。null 表示没打开——打开时才去读盘算计划。
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null);
  const [justDeleted, setJustDeleted] = useState<DeleteResult | null>(null);
```

3）在 `refresh` 里，把

```ts
      setJustArchived(null);
      setMessage(null);
```

改成

```ts
      setJustArchived(null);
      setJustDeleted(null);
      // 换了笔记，上一篇算出来的删除计划就不能再用了
      setDeletePlan(null);
      setMessage(null);
```

4）在 `doArchive` 函数之后追加两个函数：

```ts
  async function openDelete() {
    if (!store) return;
    const noteId = planOf(state)?.note.noteId;
    if (!noteId) return;
    try {
      setDeletePlan(await planDelete(store, noteId));
    } catch (e) {
      setMessage(`读取索引失败，删除没有开始：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function confirmDelete() {
    if (!store || !root || !deletePlan) return;
    // 点确认本身就是用户手势，权限刚被回收时点一次「允许」就能继续。
    // 必须赶在其他 await 之前，手势的有效期只有几秒。
    if (!(await ensurePermission(root))) {
      setMessage('目录授权已失效，什么都没删。请重新授权后再试。');
      return;
    }
    const plan = deletePlan;
    let res: DeleteResult;
    try {
      res = await deleteNote(store, plan);
    } catch (e) {
      if (isMissingError(e)) {
        setMessage('数据仓库目录已不存在，删除没有完成。');
        setState({ kind: 'missing_root' });
        return;
      }
      // 顺序保证了残留只会是孤儿目录，所以这句话永远成立
      setMessage(`删除失败：${e instanceof Error ? e.message : String(e)}。索引指针可能已删除，数据目录可能有残留。`);
      return;
    }
    // 必须先 refresh 再记结果：refresh 会清空「本次」标记
    await refresh();
    setJustDeleted(res);
  }
```

5）`<NoteView ... />` 的 props 补上五个：

```tsx
        <NoteView
          state={state}
          collector={collector ?? ''}
          datasetPath={datasetPath}
          onEditDatasetPath={() => setEditingPath(true)}
          onArchive={(m) => void doArchive(m)}
          progress={progress}
          message={message}
          justArchived={justArchived}
          pageStep={pageStep}
          deletePlan={deletePlan}
          onOpenDelete={() => void openDelete()}
          onCancelDelete={() => setDeletePlan(null)}
          onConfirmDelete={() => void confirmDelete()}
          justDeleted={justDeleted}
        />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run && npm run build`
Expected: 测试全过（含 `tests/sidepanel/path-ui.test.ts` 里已有的 `NoteView` 用例——它们会因为缺新 prop 而类型报错，需要把那些用例的 props 补齐；补的时候照抄本任务 `noteViewProps` 里的五个默认值）。构建成功。

- [ ] **Step 5: 提交**

```bash
git add src/sidepanel tests/sidepanel
git commit -m "$(cat <<'EOF'
feat: 侧边栏可以删掉已采集的笔记

自己采过和别人采过都能删，删完状态回到「可采集」并给一张结果卡。
确认时先要一次权限——点击是用户手势，权限刚被回收也能就地恢复。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 浏览页改拿完整 `Store`

浏览页的定位从「只读浏览器」改成**数据仓库的管理中心**。删除是第一个管理动作，后面还会有别的；为一个已经不成立的定位保留边界，只会让每个新功能都要先绕一次。

要点：`src/core/browse/*` 的签名**保持 `ReadStore` 不动**——那些模块确实不写盘，放宽只会丢掉一层免费的保证。

**Files:**
- Modify: `src/browser/components/PermissionGate.tsx`
- Modify: `src/browser/App.tsx:1-26`
- Modify: `src/core/read-store.ts`（删掉 `toReadStore`）
- Modify: `tests/core/read-store.test.ts`（删掉 `toReadStore` 的用例）
- Modify: `docs/superpowers/specs/2026-08-04-dataset-browser-design.md`

**Interfaces:**
- Consumes: `hasPermission` / `ensurePermission`（`src/core/handle-store.ts`，既有）
- Produces: `src/browser/App.tsx` 的 `store` 状态类型变成 `Store | null`

- [ ] **Step 1: 先让编译器把要改的地方指出来**

这个任务是纯类型层面的改动，没有可先写的失败行为测试——它的「红」由 TypeScript 提供。先制造这个红：

删掉 `src/core/read-store.ts` 末尾的 `toReadStore` 函数及其上面那行注释，同时删掉 `tests/core/read-store.test.ts` 里整个 `describe('toReadStore', ...)` 块与顶部 import 里的 `toReadStore`（`ReadStore` 类型的 import 若还有别处用就留着）。

- [ ] **Step 2: 跑构建确认失败**

Run: `npm run build`
Expected: FAIL —— `src/browser/App.tsx` 报 `toReadStore` 找不到。这正是要修的那一处：浏览页不该再把 `Store` 降级成 `ReadStore`。

- [ ] **Step 3: 实现**

`src/browser/components/PermissionGate.tsx`：

把顶部 import 改成：

```ts
import { useCallback, useEffect, useState } from 'react';
import { ensurePermission, hasPermission, loadRootHandle, rootExists } from '../../core/handle-store';
import { createStore, type Store } from '../../core/store';
```

删掉

```ts
/**
 * 浏览页只读，所以只申请 read。注意这并不会把句柄降权——句柄仍是侧边栏
 * 用 readwrite 取得的那一个，「只读」由模块边界保证，见设计 §8.1。
 */
const MODE = { mode: 'read' as const };
```

把 `useEffect` 里那行

```ts
      if ((await handle.queryPermission(MODE)) === 'granted') return await attach(handle);
```

改成

```ts
      // 浏览页是管理中心，要能删数据，所以查的是 readwrite。句柄本来就是侧边栏
      // 用 readwrite 取得的那一个，这里改的是声明，不是能力。
      if (await hasPermission(handle)) return await attach(handle);
```

把底部授权按钮的 onClick 里那行

```ts
            if ((await gate.handle.requestPermission(MODE)) === 'granted') await attach(gate.handle);
```

改成

```ts
            if (await ensurePermission(gate.handle)) await attach(gate.handle);
```

并把那句提示文案

```tsx
      <p>浏览数据仓库需要读取授权。浏览器要求这一步由你点击触发。</p>
```

改成

```tsx
      <p>访问数据仓库需要授权。浏览器要求这一步由你点击触发。</p>
```

`src/browser/App.tsx`：

把第 2 行

```ts
import { toReadStore, type ReadStore } from '../core/read-store';
```

删掉，并把第 3 行改成

```ts
import type { Store } from '../core/store';
```

把第 19 行

```ts
  const [store, setStore] = useState<ReadStore | null>(null);
```

改成

```ts
  const [store, setStore] = useState<Store | null>(null);
```

把 `onReady` 整个替换成：

```ts
  // 浏览页是管理中心，要能删数据，所以留完整 Store。core/browse/* 仍然只收
  // ReadStore——那些模块确实不写盘，放宽只会白丢一层免费的保证。
  const onReady = useCallback((s: Store, name: string) => {
    setStore(s);
    setRootName(name);
  }, []);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run && npm run build`
Expected: 测试全过、构建成功。构建通过就说明 `core/browse/*` 收 `Store` 也没问题（`Store extends ReadStore`），且没有别处还在用 `toReadStore`。

- [ ] **Step 5: 同步设计文档**

`docs/superpowers/specs/2026-08-04-dataset-browser-design.md`：

把 §2 的

```markdown
**做：** 只读浏览。目录树、笔记列表、笔记详情、图片查看、评论查看、搜索、排序、按采集者筛选、数据质量提示。
```

改成

```markdown
**做：** 浏览与管理。目录树、笔记列表、笔记详情、图片查看、评论查看、搜索、排序、按采集者筛选、数据质量提示，以及删除单篇笔记（见 `2026-08-07-delete-archived-note-design.md`）。
```

把 §2「不做」里的

```markdown
- **任何写盘操作。** 不删除、不移动、不改归属、不重新采集
```

改成

```markdown
- **删除以外的写盘操作。** 不移动、不改归属、不重新采集
```

删掉 §2 末尾那行

```markdown
**「只读」是模块边界保证的，不是平台能力保证的。** 见 §8.1。
```

把 §6.1 里的

```markdown
**浏览页的所有模块，参数类型只写 `ReadStore`，绝不导入 `Store`。** 这是「只读」的真正保证——不是权限层面的，是模块边界层面的（§8.1）。测试用只实现 `ReadStore` 的 fake，任何隐藏的写依赖都会直接编译不过。
```

改成

```markdown
**`src/core/browse/*` 的参数类型只写 `ReadStore`，绝不导入 `Store`。** 这些模块（扫描、搜索、排序、行元数据、质量检查）确实不写盘，收窄类型是一层免费的保证：测试用只实现 `ReadStore` 的 fake，任何隐藏的写依赖都会直接编译不过。页面组件那一层不受此限——浏览页要能删数据，见 §8.1。
```

把整个 §8.1 替换成：

```markdown
### 8.1 权限，以及浏览页为什么能写

浏览页复用的是侧边栏用 `readwrite` 模式取得、存进 IndexedDB 的**同一个**句柄。它从来就有写的能力——早期版本对它调 `queryPermission({mode: 'read'})`，那只是查询读权限的状态，**既不会撤销已有的 readwrite 权限，也不会返回一个降权后的新句柄**。

现在浏览页的定位是**数据仓库的管理中心**，删除是第一个管理动作（见 `2026-08-07-delete-archived-note-design.md`），所以权限门直接查 `readwrite`，复用 `handle-store` 的 `hasPermission` / `ensurePermission`，页面组件拿完整 `Store`。

保留下来的边界是 `src/core/browse/*`：那一层只收 `ReadStore`（§6.1）。扫描、搜索、排序、行元数据、质量检查都不该写盘，收窄类型让这件事由编译器保证，而不是靠自觉。

权限门本身照旧：不是 `granted` 就整页显示「授权访问数据仓库」按钮——`requestPermission` 必须由用户手势触发，页面加载时自动调用不会生效。从未配置过 root 时显示「请先在侧边栏选择数据仓库目录」。
```

- [ ] **Step 6: 提交**

```bash
git add src/browser src/core/read-store.ts tests/core/read-store.test.ts docs/superpowers/specs/2026-08-04-dataset-browser-design.md
git commit -m "$(cat <<'EOF'
refactor: 浏览页改拿完整 Store，定位从只读浏览器变成管理中心

权限门改查 readwrite（句柄本来就是 readwrite 取得的，改的是声明不是能力）。
core/browse/* 仍只收 ReadStore——那些模块不写盘，收窄类型是免费的保证。
不再有调用方的 toReadStore 一并删掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `dropNote` —— 从目录树里摘掉一篇

删完之后左侧目录树的计数要跟着减。这是个纯函数，先单独做出来测透。

空掉的叶子和因此没了孩子的中间节点要一并消失，与 `buildTree` 的行为一致（它本来就不显示没有任何后代数据集的中间目录），也与磁盘上「父目录变空就删」对得上。

**Files:**
- Modify: `src/core/browse/scope.ts`
- Test: `tests/core/browse/scope.test.ts`

**Interfaces:**
- Consumes: `DatasetNode`（`src/core/browse/types.ts`，既有）
- Produces: `dropNote(nodes: DatasetNode[], noteId: string): DatasetNode[]`

- [ ] **Step 1: 写失败的测试**

在 `tests/core/browse/scope.test.ts` 末尾追加（若该文件不存在则新建，并按同目录其他测试的写法补上 import）：

```ts
import { dropNote } from '../../../src/core/browse/scope';
import type { DatasetNode } from '../../../src/core/browse/types';

const leaf = (path: string, noteIds: string[]): DatasetNode => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  isDataset: true,
  count: noteIds.length,
  noteIds,
  ignoredDirs: [],
  children: [],
});

const branch = (path: string, children: DatasetNode[]): DatasetNode => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  isDataset: false,
  count: children.reduce((a, c) => a + c.count, 0),
  noteIds: [],
  ignoredDirs: [],
  children,
});

describe('dropNote', () => {
  it('从叶子里摘掉并把计数减一', () => {
    const tree = [branch('collected', [leaf('collected/2026-08-03', ['a', 'b'])])];
    const next = dropNote(tree, 'a');
    expect(next[0]!.count).toBe(1);
    expect(next[0]!.children[0]!.noteIds).toEqual(['b']);
    expect(next[0]!.children[0]!.count).toBe(1);
  });

  // 删除按 note_id 清全部痕迹，同一篇可能同时存在于几个数据集目录
  it('同一篇存在于多个数据集时全部摘掉', () => {
    const tree = [
      branch('collected', [leaf('collected/2026-08-03', ['a', 'b'])]),
      branch('alice', [leaf('alice/2026-08-01', ['a'])]),
    ];
    const next = dropNote(tree, 'a');
    expect(next).toHaveLength(1);
    expect(next[0]!.path).toBe('collected');
    expect(next[0]!.count).toBe(1);
  });

  // 与 buildTree 一致：空掉的节点不显示，也与磁盘上「父目录变空就删」对得上
  it('叶子空了就连同变空的父节点一起消失', () => {
    const tree = [branch('collected', [leaf('collected/2026-08-03', ['a'])])];
    expect(dropNote(tree, 'a')).toEqual([]);
  });

  it('父节点还有别的孩子就留下', () => {
    const tree = [branch('collected', [
      leaf('collected/2026-08-03', ['a']),
      leaf('collected/2026-08-04', ['b']),
    ])];
    const next = dropNote(tree, 'a');
    expect(next[0]!.children.map((c) => c.path)).toEqual(['collected/2026-08-04']);
    expect(next[0]!.count).toBe(1);
  });

  it('树里没有这篇时原样返回', () => {
    const tree = [branch('collected', [leaf('collected/2026-08-03', ['a'])])];
    const next = dropNote(tree, 'zzz');
    expect(next[0]!.children[0]!.noteIds).toEqual(['a']);
    expect(next[0]!.count).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/browse/scope.test.ts`
Expected: FAIL —— `dropNote is not a function`。

- [ ] **Step 3: 实现**

`src/core/browse/scope.ts` 末尾追加：

```ts
/**
 * 从树里摘掉一篇笔记，返回新树。删除按 note_id 清全部痕迹，所以同一篇可能
 * 同时挂在几个数据集目录下，要全摘掉。
 *
 * 空掉的叶子与因此没了孩子的中间节点一并消失：buildTree 本来就不显示没有任何
 * 后代数据集的中间目录，磁盘上那个变空的目录也会被 deleteNote 删掉，树上留着
 * 一个 0 的节点等于显示一个已经不存在的目录。
 */
export function dropNote(nodes: DatasetNode[], noteId: string): DatasetNode[] {
  const out: DatasetNode[] = [];
  for (const n of nodes) {
    if (n.isDataset) {
      const noteIds = n.noteIds.filter((id) => id !== noteId);
      if (noteIds.length === 0) continue;
      out.push({ ...n, noteIds, count: noteIds.length });
      continue;
    }
    const children = dropNote(n.children, noteId);
    if (children.length === 0) continue;
    out.push({ ...n, children, count: children.reduce((a, c) => a + c.count, 0) });
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/browse/scope.test.ts`
Expected: PASS，5 个新测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/core/browse/scope.ts tests/core/browse/scope.test.ts
git commit -m "$(cat <<'EOF'
feat: 新增 dropNote，从目录树里摘掉一篇笔记

同一篇可能挂在多个数据集目录下，要全摘掉。空掉的节点一并消失，与 buildTree
的行为和磁盘上「父目录变空就删」都对得上。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 缓存失效改由显式 `epoch` 触发

`useRows` 现在在 `refs` 变化时清空整块行缓存，`App` 的 `scanned` 标记也挂在 `refs.length` 上。删掉一行会让 `refs` 变成新数组，于是**每删一篇就要重读全部行、并且排序/搜索的扫描结果作废**——设计里承诺的「不重扫、已扫描状态不丢」就落空了。

真正该触发失效的是「换了范围」和「点了重新加载」，不是「少了一行」。所以把失效条件显式化成一个 `epoch` 字符串。

**Files:**
- Modify: `src/browser/hooks/useRows.ts`
- Modify: `src/browser/hooks/useScope.ts`
- Modify: `src/browser/App.tsx`

**Interfaces:**
- Consumes: `dropNote`（Task 7）
- Produces:
  - `useRows(store: ReadStore | null, epoch: string)`（第二个参数由 `refs: NoteRef[]` 改成 `epoch: string`）
  - `useScope` 的返回值新增 `gen: number` 与 `removeNote(noteId: string): void`

- [ ] **Step 1: 改 `useRows`**

`src/browser/hooks/useRows.ts`：

把签名与那个清空 effect 改成：

```ts
export function useRows(store: ReadStore | null, epoch: string) {
  const [version, setVersion] = useState(0);
  const sink = useRef<ScanSink>({ metas: new Map(), details: new Map(), errors: new Map() });
  const inflight = useRef(new Set<NoteKey>());

  // 只在换范围或点「重新加载」时清空——那两件事才意味着「想看磁盘上的新状态」。
  // 挂在 refs 上是不行的：删掉一行也会换出新数组，于是删一篇就要重读全部行。
  useEffect(() => {
    sink.current = { metas: new Map(), details: new Map(), errors: new Map() };
    inflight.current.clear();
    setVersion((v) => v + 1);
  }, [epoch]);
```

其余不动（`NoteRef` 的 import 仍然要留着，`request` 用它）。

- [ ] **Step 2: 改 `useScope`**

`src/browser/hooks/useScope.ts`：

顶部 import 补上：

```ts
import { collectRefs, dropNote } from '../../core/browse/scope';
```

（替换掉原来只 import `collectRefs` 的那行。）

在 `const reload = ...` 之前插入：

```ts
  /** 删掉一篇之后就地更新树，不重扫仓库。refs 由下面那个 effect 自动跟着变。 */
  const removeNote = useCallback((noteId: string) => {
    setTree((prev) => dropNote(prev, noteId));
  }, []);

  // 选中的数据集可能因为删掉最后一篇而整个消失，留着会让面包屑指向一个不存在的目录
  useEffect(() => {
    if (selected !== null && findNode(tree, selected) === null) setSelected(null);
  }, [tree, selected]);
```

把 return 改成：

```ts
  return { tree, refs, selected, select: setSelected, progress, reload, removeNote, gen };
```

- [ ] **Step 3: 改 `App`**

`src/browser/App.tsx`：

把

```ts
  const { tree, refs, selected, select, progress, reload } = useScope(store);
  const total = useMemo(() => tree.reduce((a, n) => a + n.count, 0), [tree]);
  const { stateOf, request, sink, version } = useRows(store, refs);
```

改成

```ts
  const { tree, refs, selected, select, progress, reload, removeNote, gen } = useScope(store);
  const total = useMemo(() => tree.reduce((a, n) => a + n.count, 0), [tree]);
  // 行缓存与「已扫描」标记都挂在这上面。删掉一行不改变 epoch，所以不会作废
  // 已经读好的元数据和已经确认过的排序/搜索范围。
  const epoch = useMemo(() => `${selected ?? '*'}::${gen}`, [selected, gen]);
  const { stateOf, request, sink, version } = useRows(store, epoch);
```

删掉

```ts
  const scopeId = useMemo(() => `${selected ?? '*'}::${refs.length}`, [selected, refs.length]);
```

并把 `ensureScanned` 里所有 `scopeId` 换成 `epoch`（两处：`scanned === scopeId` 与 `setScanned(scopeId)`），依赖数组里的 `scopeId` 也换成 `epoch`。

把 TopBar 的

```tsx
          onReload={() => { setScanned(null); reload(); }}
```

改成

```tsx
          {/* reload 会 +1 gen，epoch 随之变化，scanned 自然对不上，不必再手动清 */}
          onReload={() => reload()}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run && npm run build`
Expected: 全过、构建成功。这一步没有新测试——它改的是缓存失效时机，行为由 Task 10 的端到端验收覆盖。

- [ ] **Step 5: 提交**

```bash
git add src/browser
git commit -m "$(cat <<'EOF'
refactor: 浏览页的行缓存改由显式 epoch 失效

原先挂在 refs 上，删掉一行会换出新数组，于是每删一篇都要重读全部行、
并且排序与搜索的扫描结果作废。真正该触发失效的只有换范围和重新加载。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 浏览页的删除块（自带状态的组件）

单独一个文件，自己管「未打开 → 算计划中 → 展示清单 → 删除中 → 出错」这条状态链，`DetailPane` 只管把它摆进去。

同样不用 modal：浏览页已经有两处抢 `Escape`（`App` 关详情栏、`Lightbox` 关看图器），再塞一个就是三方打架。

**Files:**
- Create: `src/browser/components/DeleteBlock.tsx`
- Modify: `src/browser/browser.css`
- Test: `tests/browser/delete-block.test.ts`（新建）

**Interfaces:**
- Consumes: `planDelete` / `deleteNote` / `DeletePlan`（Task 2、3）、`noteKeyOf`（既有）、`isPermissionError`（`src/core/handle-store.ts`，既有）
- Produces:
  ```ts
  function DeleteBlock(props: {
    store: Store;
    noteRef: NoteRef;
    onDeleted(): void;   // 删成功后调用，上层负责摘行、关详情栏、弹提示
  }): JSX.Element
  ```

- [ ] **Step 1: 写失败的测试**

创建 `tests/browser/delete-block.test.ts`：

```ts
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import { DeleteBlock } from '../../src/browser/components/DeleteBlock';
import type { Pointer } from '../../src/types';

afterEach(cleanup);

const NOTE = '6a030b860000000036000201';
const DIR = `collected/2026-08-03/${NOTE}`;

const pointer = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

async function seeded(): Promise<Store> {
  const store = createStore(memRoot());
  await writePointer(store, pointer('zach', DIR));
  await store.writeFile(`${DIR}/note.json`, '{}');
  return store;
}

const noteRef = { noteId: NOTE, datasetPath: 'collected/2026-08-03' };

describe('DeleteBlock', () => {
  it('一开始只有入口按钮', async () => {
    render(createElement(DeleteBlock, { store: await seeded(), noteRef, onDeleted: vi.fn() }));
    expect(screen.getByRole('button', { name: '删除这篇' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
  });

  it('点入口后列出将删的目录与指针', async () => {
    render(createElement(DeleteBlock, { store: await seeded(), noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));

    await waitFor(() => expect(screen.getByText(`${DIR}/`)).toBeTruthy());
    expect(screen.getByText('索引指针：zach')).toBeTruthy();
  });

  // 「删掉这篇的所有痕迹」可能连带删掉别处那一份，必须先看得见
  it('别处还有一份时，两个目录都列出来', async () => {
    const store = await seeded();
    await writePointer(store, pointer('alice', `alice/2026-08-01/${NOTE}`));
    render(createElement(DeleteBlock, { store, noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));

    await waitFor(() => expect(screen.getByText(`alice/2026-08-01/${NOTE}/`)).toBeTruthy());
    expect(screen.getByText(`${DIR}/`)).toBeTruthy();
  });

  it('取消后回到只有入口的样子，什么都没删', async () => {
    const store = await seeded();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull());
    expect(await store.exists(`${DIR}/note.json`)).toBe(true);
  });

  it('确认后真的删掉，并通知上层', async () => {
    const store = await seeded();
    const onDeleted = vi.fn();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(await store.exists(`${DIR}/note.json`)).toBe(false);
    expect(await store.exists(`_index/6a/${NOTE}/zach.json`)).toBe(false);
  });

  it('删除出错时把原因摆出来，不通知上层', async () => {
    const base = await seeded();
    const store: Store = {
      ...base,
      removeDir: async (path: string) => {
        if (path.startsWith('collected')) throw new Error('boom');
        return base.removeDir(path);
      },
    };
    const onDeleted = vi.fn();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/browser/delete-block.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/browser/components/DeleteBlock"`。

- [ ] **Step 3: 实现**

创建 `src/browser/components/DeleteBlock.tsx`：

```tsx
import { useState } from 'react';
import { deleteNote, planDelete, type DeletePlan } from '../../core/delete';
import { isPermissionError } from '../../core/handle-store';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { Store } from '../../core/store';

type Phase =
  | { kind: 'idle' }
  | { kind: 'planning' }
  | { kind: 'confirm'; plan: DeletePlan }
  | { kind: 'deleting'; plan: DeletePlan }
  | { kind: 'error'; text: string };

/**
 * 删除入口 + 内联确认块。
 *
 * 不用 modal：浏览页已经有两处抢 Escape（App 关详情栏、Lightbox 关看图器），
 * 再塞一个就是三方打架，得引入一套焦点与优先级管理，为一个确认框不值。
 * 也不用 window.confirm——它显示不了清单，而清单正是这个确认框存在的理由。
 */
export function DeleteBlock({
  store, noteRef, onDeleted,
}: {
  store: Store;
  noteRef: NoteRef;
  onDeleted(): void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  async function open() {
    setPhase({ kind: 'planning' });
    try {
      // 传 here：当前这份目录可能根本没有指针（孤儿副本），光查指针找不到它
      setPhase({ kind: 'confirm', plan: await planDelete(store, noteRef.noteId, noteKeyOf(noteRef)) });
    } catch (e) {
      setPhase({ kind: 'error', text: `读取索引失败：${message(e)}` });
    }
  }

  async function confirm(plan: DeletePlan) {
    setPhase({ kind: 'deleting', plan });
    try {
      await deleteNote(store, plan);
    } catch (e) {
      // 权限在扩展 origin 的最后一个标签页关闭时会被回收。浏览页手里没有句柄，
      // 恢复不了，只能让人重来一遍权限门。
      if (isPermissionError(e)) {
        setPhase({ kind: 'error', text: '授权已失效。请重新加载本页并重新授权后再试。' });
        return;
      }
      // 顺序保证了残留只会是孤儿目录，所以这句话永远成立
      setPhase({ kind: 'error', text: `删除失败：${message(e)}。索引指针可能已删除，数据目录可能有残留。` });
      return;
    }
    setPhase({ kind: 'idle' });
    onDeleted();
  }

  if (phase.kind === 'idle' || phase.kind === 'planning') {
    return (
      <div className="bw-del">
        <button className="bw-btn danger" disabled={phase.kind === 'planning'} onClick={() => void open()}>
          删除这篇
        </button>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div className="bw-del">
        <p className="bw-note bad">{phase.text}</p>
        <button className="bw-btn" onClick={() => setPhase({ kind: 'idle' })}>知道了</button>
      </div>
    );
  }

  const { plan } = phase;
  const busy = phase.kind === 'deleting';

  return (
    <div className="bw-del open">
      <p className="bw-del-h">删除后不可撤销，恢复只能靠 git</p>
      <div className="bw-del-list">
        {plan.dirs.length === 0 ? (
          <p className="bw-dim">没有数据目录，只清理索引指针</p>
        ) : (
          plan.dirs.map((d) => <p key={d}>{d}/</p>)
        )}
        {plan.pointers.length > 0 && (
          <p className="bw-dim">索引指针：{plan.pointers.map((p) => p.collector).join('、')}</p>
        )}
      </div>
      <div className="bw-del-acts">
        <button className="bw-btn" disabled={busy} onClick={() => setPhase({ kind: 'idle' })}>取消</button>
        <button className="bw-btn danger" disabled={busy} onClick={() => void confirm(plan)}>
          {busy ? '删除中…' : '确认删除'}
        </button>
      </div>
    </div>
  );
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

`src/browser/browser.css`：在 `.bw-note.bad` 那一行之后追加：

```css
/* 危险动作。红色只标它，不做常规按钮 */
.bw-btn.danger { color: var(--accent); }
.bw-btn.danger:hover { background: var(--accent-w); border-color: var(--accent); }

.bw-del { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.bw-del.open {
  border: 1px solid var(--accent); border-radius: 8px;
  padding: 9px 10px; background: var(--accent-w);
}
.bw-del-h { margin: 0; font-size: 12px; font-weight: 600; color: var(--accent); }
.bw-del-list { display: flex; flex-direction: column; gap: 3px; }
.bw-del-list p {
  margin: 0; font-size: 11.5px; word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bw-del-acts { display: flex; gap: 6px; }
.bw-del-acts .bw-btn { flex: 1; }

/* 删完之后的提示条，让「这一篇没了」有明确的反馈 */
.bw-toast {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px; border-bottom: 1px solid var(--line);
  background: var(--ok-w); color: var(--ok); font-size: 12px;
}
.bw-toast .bw-btn { margin-left: auto; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/browser/delete-block.test.ts`
Expected: PASS，6 个测试全过。

- [ ] **Step 5: 提交**

```bash
git add src/browser/components/DeleteBlock.tsx src/browser/browser.css tests/browser/delete-block.test.ts
git commit -m "$(cat <<'EOF'
feat: 浏览页新增删除块，自带清单与确认

内联展开而不是 modal——浏览页已有两处抢 Escape（关详情栏、关看图器），
再加一个就要引入焦点优先级管理。算计划时传当前目录，孤儿副本也删得掉。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 浏览页接线与文档收尾

把 `DeleteBlock` 摆进详情栏，接上删除之后的三件事：那一行从列表消失、**详情栏关闭**、目录树计数减一，外加一条提示条——使用者要能明确感知这一篇没了。

**Files:**
- Modify: `src/browser/components/DetailPane.tsx`
- Modify: `src/browser/App.tsx`
- Modify: `CLAUDE.md`
- Test: 无新增（组件层已由 Task 9 覆盖，接线由构建与人工验收把关）

**Interfaces:**
- Consumes: `DeleteBlock`（Task 9）、`removeNote`（Task 8）
- Produces: `DetailPane` 的 `store` prop 类型由 `ReadStore` 改成 `Store`，新增 `onDeleted(): void`

- [ ] **Step 1: 改 `DetailPane`**

`src/browser/components/DetailPane.tsx`：

顶部 import 补上：

```ts
import type { Store } from '../../core/store';
import { DeleteBlock } from './DeleteBlock';
```

把 `DetailPane` 的 props 改成：

```tsx
export function DetailPane({
  store, noteRef, meta, detail, onClose, thumbUrl, onDeleted,
}: {
  /** 详情栏要能删数据，所以收完整 Store。core/browse/* 那一层仍只收 ReadStore */
  store: Store;
  noteRef: NoteRef;
  meta: RowMeta;
  detail: NoteDetail;
  onClose(): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
  onDeleted(): void;
}) {
```

在 `</section>`（评论那一段）之后、`</div>`（`bw-detail-body`）之前插入：

```tsx
        <DeleteBlock store={store} noteRef={noteRef} onDeleted={onDeleted} />
```

- [ ] **Step 2: 改 `App`**

`src/browser/App.tsx`：

在 `const [cursor, setCursor] = useState(0);` 之后加：

```ts
  // 刚删掉的那一篇的标题。删除的反馈必须显式，否则一行悄悄消失像是出了 bug。
  const [deletedTitle, setDeletedTitle] = useState<string | null>(null);
```

在 `useEffect(() => { localStorage.setItem('bw.paneWidth', ...) }, [paneWidth]);` 之后加：

```ts
  // 删掉的可能正是最后一行，游标要收回来，否则详情栏那段的 current 会是 undefined
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, refs.length - 1)));
  }, [refs.length]);
```

在 `<div className="bw-list">` 之内、`<Table ... />` 之前插入提示条：

```tsx
            {deletedTitle !== null && (
              <div className="bw-toast">
                已删除《{deletedTitle || '无标题'}》
                <button className="bw-btn" onClick={() => setDeletedTitle(null)}>知道了</button>
              </div>
            )}
```

给 `DetailPane` 补上 `onDeleted`：

```tsx
                <DetailPane
                  store={store}
                  noteRef={current}
                  meta={currentState.meta}
                  detail={sink.details.get(currentKey!)!}
                  onClose={() => setDetailOpen(false)}
                  thumbUrl={thumbUrl}
                  onDeleted={() => {
                    // 三件事缺一不可：行消失、详情栏关掉、提示条给出反馈。
                    // 只摘行的话，详情栏会继续显示一篇已经不存在的笔记。
                    setDeletedTitle(currentState.meta.title);
                    setDetailOpen(false);
                    removeNote(current.noteId);
                  }}
                />
```

- [ ] **Step 3: 跑测试与构建**

Run: `npx vitest run && npm run build`
Expected: 全部测试通过、构建成功。

- [ ] **Step 4: 同步 `CLAUDE.md`**

在「现状」那一节的 bullet 列表末尾追加：

```markdown
- **可以删掉采错的笔记**：侧边栏与浏览页详情栏各一个「删除这篇」。按 `note_id` 清掉全部
  指针与它们指向的目录，不再需要手动去仓库里删两处。设计见
  `docs/superpowers/specs/2026-08-07-delete-archived-note-design.md`
```

在「已定的决策，不要重开讨论」的表格末尾追加三行：

```markdown
| 删除按 `note_id` 清全部痕迹 | 不要只删眼前这一份——同一篇存成多份本来就是要清理的异常，删一次只清一份等于让人重复劳动 |
| 删除时先删指针、再删数据目录 | 不要反过来。中断后留孤儿目录是安全的（`quality.ts` 的 `no_pointer` 认得它），留孤儿指针会破坏「指针存在 ⟹ 数据完整」，污染所有人的查重 |
| 浏览页是管理中心，页面组件拿完整 `Store` | 但 `src/core/browse/*` 仍只收 `ReadStore`，不要一起放宽——那些模块不写盘，收窄类型是免费的保证 |
```

- [ ] **Step 5: 提交**

```bash
git add src/browser CLAUDE.md
git commit -m "$(cat <<'EOF'
feat: 浏览页详情栏可以删掉这篇笔记

删完后那一行从列表消失、详情栏关闭、目录树计数减一，外加一条提示条——
一行悄悄消失像是出了 bug，反馈必须显式。不重扫仓库，排序与搜索状态不丢。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 人工验收（需要使用者操作，agent 做不了）**

在 `chrome://extensions` 加载 `dist/` 后，逐条走：

1. 采一篇笔记 → 侧边栏出现「删除这篇」→ 点开，清单里是那个目录和自己的采集者名
2. 点「取消」→ 确认块收起，仓库里什么都没少
3. 再点开 → 「确认删除」→ 状态卡显示「已删除」，仓库里笔记目录与 `_index` 下的指针都没了，空掉的日期目录也没了
4. 手动删掉某篇的笔记目录但保留指针 → 侧边栏仍显示「你采过这篇」→ 点删除 → 清单显示「没有数据目录，只清理索引指针」→ 删完状态回到「可采集」
5. 浏览页选中一篇 → 详情栏底部「删除这篇」→ 清单正确 → 确认 → 该行消失、详情栏关闭、顶部出现「已删除《标题》」、左侧目录树计数减一
6. 浏览页删除前先做一次排序（会问「需要读取 N 篇」）→ 删掉一篇 → **不应该再问一次**，排序结果也不该重来
7. 浏览页删掉某个数据集里的最后一篇 → 该数据集节点从树上消失，范围自动回到「全部」

---

## 自查

**Spec 覆盖：**

| 设计文档 | 对应任务 |
|---|---|
| §2 删除范围（全部指针 + 全部目录 + `here` + 空父目录） | Task 2（计划）、Task 3（执行） |
| §2 不做批量 / 回收站 / 撤销 | 全篇没有任何一处实现它们 |
| §3 `planDelete` / `deleteNote` 两步 | Task 2、Task 3 |
| §4.1 先指针后目录 | Task 3（含顺序断言测试） |
| §4.2 步骤 | Task 3 |
| §4.3 空父目录边界与 `archiver` 共用 | Task 3 |
| §5 浏览页拿完整 `Store`、`core/browse/*` 不变 | Task 6 |
| §6 `lookup` 放宽、删掉 `quality.ts` 的重复实现 | Task 1 |
| §7.1 内联确认块，不用 modal / `window.confirm` | Task 4（侧边栏）、Task 9（浏览页） |
| §7.2 侧边栏入口条件、禁用、结果卡 | Task 4、Task 5 |
| §7.3 浏览页入口、传 `here`、删后四件事、不重扫 | Task 8、Task 9、Task 10 |
| §8 错误处理（权限、目录消失、部分失败） | Task 5（侧边栏）、Task 9（浏览页） |
| §9 测试清单 | Task 2、3、4、5、7、9 |

设计文档 §7.3 承诺的「已扫描的排序/搜索状态不丢」在原有实现下做不到（`useRows` 挂在 `refs` 上），因此补了 Task 8 专门处理——这是自查中发现的缺口。
