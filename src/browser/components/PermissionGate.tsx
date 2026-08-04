import { useCallback, useEffect, useState } from 'react';
import { loadRootHandle } from '../../core/handle-store';
import { createStore, type Store } from '../../core/store';

type Gate =
  | { kind: 'checking' }
  | { kind: 'no_root' }
  | { kind: 'need_permission'; handle: FileSystemDirectoryHandle }
  | { kind: 'ready' };

/**
 * 浏览页只读，所以只申请 read。注意这并不会把句柄降权——句柄仍是侧边栏
 * 用 readwrite 取得的那一个，「只读」由模块边界保证，见设计 §8.1。
 */
const MODE = { mode: 'read' as const };

export function PermissionGate({
  onReady,
  children,
}: {
  onReady(store: Store, rootName: string): void;
  children: React.ReactNode;
}) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });

  const attach = useCallback(
    (handle: FileSystemDirectoryHandle) => {
      onReady(createStore(handle), handle.name);
      setGate({ kind: 'ready' });
    },
    [onReady],
  );

  useEffect(() => {
    void (async () => {
      const handle = await loadRootHandle();
      if (!handle) return setGate({ kind: 'no_root' });
      // 页面加载时不能直接 requestPermission：它必须由用户手势触发，
      // 自动调用会被浏览器忽略，用户只会看到一个卡住的空页面。
      if ((await handle.queryPermission(MODE)) === 'granted') return attach(handle);
      setGate({ kind: 'need_permission', handle });
    })();
  }, [attach]);

  if (gate.kind === 'ready') return <>{children}</>;
  if (gate.kind === 'checking') return <div className="bw-gate"><p>正在连接数据仓库…</p></div>;
  if (gate.kind === 'no_root') {
    return (
      <div className="bw-gate">
        <p>还没有选择数据仓库目录。请在小红书页面打开侧边栏，先选好目录，再回到这里。</p>
      </div>
    );
  }
  return (
    <div className="bw-gate">
      <p>浏览数据仓库需要读取授权。浏览器要求这一步由你点击触发。</p>
      <button
        onClick={() => {
          void (async () => {
            if ((await gate.handle.requestPermission(MODE)) === 'granted') attach(gate.handle);
          })();
        }}
      >
        授权访问数据仓库
      </button>
    </div>
  );
}
