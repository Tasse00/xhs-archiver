import { useCallback, useEffect, useMemo, useState } from 'react';
import { toReadStore, type ReadStore } from '../core/read-store';
import type { Store } from '../core/store';
import { noteKeyOf } from '../core/browse/scope';
import { PermissionGate } from './components/PermissionGate';
import { Tree } from './components/Tree';
import { Table } from './components/Table';
import { DetailPane } from './components/DetailPane';
import { useScope } from './hooks/useScope';
import { useRows } from './hooks/useRows';
import { useThumbnail } from './hooks/useThumbnail';

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
  const { stateOf, request, sink } = useRows(store, refs);
  const { thumbUrl, forget } = useThumbnail(store);

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
            <Table
              refs={refs}
              stateOf={stateOf}
              request={request}
              thumbUrl={thumbUrl}
              forget={forget}
              wide={!detailOpen}
              selectedKey={currentKey}
              onSelect={(r) => { setCursor(refs.findIndex((x) => noteKeyOf(x) === noteKeyOf(r))); setDetailOpen(true); }}
            />
          </div>
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
        </div>
      </PermissionGate>
    </div>
  );
}
