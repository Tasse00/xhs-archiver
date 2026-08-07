import { useCallback, useEffect, useState } from 'react';
import { buildTree, type BuildProgress } from '../../core/browse/tree';
import { collectRefs, dropNote } from '../../core/browse/scope';
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

  /** 删掉一篇之后就地更新树，不重扫仓库。refs 由下面那个 effect 自动跟着变。 */
  const removeNote = useCallback((noteId: string) => {
    setTree((prev) => dropNote(prev, noteId));
  }, []);

  // 选中的数据集可能因为删掉最后一篇而整个消失，留着会让面包屑指向一个不存在的目录
  useEffect(() => {
    if (selected !== null && findNode(tree, selected) === null) setSelected(null);
  }, [tree, selected]);

  return { tree, refs, selected, select: setSelected, progress, reload, removeNote, gen };
}
