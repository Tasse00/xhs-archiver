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
