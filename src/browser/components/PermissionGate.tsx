import { useCallback, useEffect, useState } from 'react';
import { ensurePermission, hasPermission, loadRootHandle, rootExists } from '../../core/handle-store';
import { createStore, type Store } from '../../core/store';

type Gate =
  | { kind: 'checking' }
  | { kind: 'no_root' }
  | { kind: 'need_permission'; handle: FileSystemDirectoryHandle }
  /** 句柄和权限都在，目录本身没了。不拦住的话扫描会把它显示成空仓库。 */
  | { kind: 'missing_root'; name: string }
  | { kind: 'ready' };

export function PermissionGate({
  onReady,
  children,
}: {
  onReady(store: Store, rootName: string): void;
  children: React.ReactNode;
}) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });

  const attach = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      // 目录被删掉后句柄不会失效，读操作只会一路返回空——不先探一次，
      // 整个浏览页会安静地显示成「仓库是空的」，而扫描到遍历目录时才抛。
      if (!(await rootExists(handle))) {
        return setGate({ kind: 'missing_root', name: handle.name });
      }
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
      // 浏览页是管理中心，要能删数据，所以查的是 readwrite。句柄本来就是侧边栏
      // 用 readwrite 取得的那一个，这里改的是声明，不是能力。
      if (await hasPermission(handle)) return await attach(handle);
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
  if (gate.kind === 'missing_root') {
    return (
      <div className="bw-gate">
        <p>
          找不到数据仓库目录 <b>{gate.name}</b>——它被删除、改名、移动，或者所在的磁盘
          没挂上。请在小红书页面打开侧边栏重新选择目录，再回到这里。
        </p>
      </div>
    );
  }
  return (
    <div className="bw-gate">
      <p>访问数据仓库需要授权。浏览器要求这一步由你点击触发。</p>
      <button
        onClick={() => {
          void (async () => {
            if (await ensurePermission(gate.handle)) await attach(gate.handle);
          })();
        }}
      >
        授权访问数据仓库
      </button>
    </div>
  );
}
