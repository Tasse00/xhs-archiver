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
