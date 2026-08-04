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
