import { describe, it, expect } from 'vitest';
import { collectRefs, compareByDefault, compareByMeta, dropNote, noteKeyOf } from '../../../src/core/browse/scope';
import type { DatasetNode, RowMeta } from '../../../src/core/browse/types';

const A = '6a61e639000000001c00e6d9';
const B = '6a6356e8000000002902e848';

function leaf(path: string, noteIds: string[]): DatasetNode {
  return {
    path, name: path.split('/').pop()!, isDataset: true,
    count: noteIds.length, noteIds, ignoredDirs: [], children: [],
  };
}

function branch(path: string, children: DatasetNode[]): DatasetNode {
  return {
    path, name: path.slice(path.lastIndexOf('/') + 1), isDataset: false,
    count: children.reduce((a, c) => a + c.count, 0), noteIds: [], ignoredDirs: [], children,
  };
}

function meta(over: Partial<RowMeta>): RowMeta {
  return {
    noteId: A, datasetPath: 'collected/2026-08-03', title: '', content: '', tags: [],
    authorNickname: '', liked: 0, collected: 0, comment: 0, share: 0,
    imageCount: 0, coverFile: null, collector: '', firstArchivedAt: '',
    lastArchivedAt: '', archiveCount: 1, publishedAt: '', lastEditedAt: '',
    authorFans: null, authorInteraction: null,
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
