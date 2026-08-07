import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toReadStore, type ReadStore } from '../core/read-store';
import type { Store } from '../core/store';
import { noteKeyOf } from '../core/browse/scope';
import { scanScope } from '../core/browse/scan';
import { filterRefs, sortRefs, type Sort } from '../core/browse/search';
import { loadComments } from '../core/browse/comments';
import type { NoteRef } from '../core/browse/types';
import { PermissionGate } from './components/PermissionGate';
import { Tree } from './components/Tree';
import { Table } from './components/Table';
import { DetailPane } from './components/DetailPane';
import { TopBar, type ScanState } from './components/TopBar';
import { browseKeyAction } from './keys';
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
  const { stateOf, request, sink, version } = useRows(store, refs);
  const { thumbUrl, forget } = useThumbnail(store);

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

  const [detailOpen, setDetailOpen] = useState(true);
  const [paneWidth, setPaneWidth] = useState(() => Number(localStorage.getItem('bw.paneWidth') ?? 380));
  const [cursor, setCursor] = useState(0);

  useEffect(() => { localStorage.setItem('bw.paneWidth', String(paneWidth)); }, [paneWidth]);

  // ↑↓ 换行、Enter 开详情。Esc 归看图器，理由见 keys.ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = browseKeyAction(e.key);
      if (action === 'next') { e.preventDefault(); setCursor((c) => Math.min(refs.length - 1, c + 1)); }
      if (action === 'prev') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      if (action === 'open-detail') setDetailOpen(true);
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
        <div className="bw-main">
          <Tree tree={tree} total={total} selected={selected} onSelect={select} />
          <div className="bw-list">
            <Table
              refs={visible}
              stateOf={stateOf}
              request={request}
              thumbUrl={thumbUrl}
              forget={forget}
              wide={!detailOpen}
              selectedKey={currentKey}
              onSelect={(r) => { setCursor(refs.findIndex((x) => noteKeyOf(x) === noteKeyOf(r))); setDetailOpen(true); }}
              sort={sort}
              onSort={(key) => { void (async () => {
                if (!(await ensureScanned())) return;
                setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
              })(); }}
              showCommentCol={showCommentCol}
              commentCount={commentCount}
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
