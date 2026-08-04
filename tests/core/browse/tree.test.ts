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
