import { useCallback, useMemo, useState } from 'react';
import { toReadStore, type ReadStore } from '../core/read-store';
import type { Store } from '../core/store';
import { PermissionGate } from './components/PermissionGate';
import { Tree } from './components/Tree';
import { useScope } from './hooks/useScope';

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
            <p className="bw-empty">列表在下一个任务里接上（当前范围 {refs.length} 篇）</p>
          </div>
        </div>
      </PermissionGate>
    </div>
  );
}
