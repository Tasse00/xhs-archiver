import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, type Store } from '../core/store';
import {
  loadRootHandle, saveRootHandle, ensurePermission, hasPermission, isPermissionError,
} from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { readNoteViaTab, type PageDiag } from '../page/read-note';
import type { ExtractedComments, ExtractedNote, Pointer } from '../types';
import { isTransient, resolvePanelState, type PanelState } from './usePanelState';
import { buildLogEntry, recordLog, shouldLog, type LogEntry } from './log';
import { RootSetup, PermissionSetup, CollectorSetup, PathSetup } from './components/Setup';
import { NoteView, type ArchiveOutcome } from './components/NoteView';
import { LogView } from './components/LogView';
import { IconRefresh, IconBrowse } from './components/Icons';
import { openBrowser } from './open-browser';
import type { ArchiveMode } from './components/Actions';

/** 重读的间隔，递增。用尽了才认定是真失败。 */
const RETRY_DELAYS = [300, 700, 1500];

/**
 * 记一次判定结果。不在笔记页上的不记（见 shouldLog），结论与上一条相同的
 * 就地合并（见 recordLog）。只在一次判定尘埃落定时调用——重试中的中间态
 * 不单独成条，重读了几次记在 attempts 里。
 */
function pushLog(
  setLog: (fn: (prev: LogEntry[]) => LogEntry[]) => void,
  state: PanelState,
  tabUrl: string,
  diag: PageDiag | null,
  attempts = 0,
) {
  if (!shouldLog(state)) return;
  setLog((prev) => recordLog(prev, buildLogEntry(state, tabUrl, diag, new Date(), attempts)));
}

/** 这次采集要写什么、覆盖谁。三种可采状态的差别全在这里。 */
interface ArchivePlan {
  note: ExtractedNote;
  comments: ExtractedComments;
  existing?: Pointer;
  /** 接管时要作废的旧指针。 */
  supersede?: Pointer[];
}

function planOf(state: PanelState): ArchivePlan | null {
  switch (state.kind) {
    case 'ready':
      return { note: state.note, comments: state.comments };
    case 'mine':
      return { note: state.note, comments: state.comments, existing: state.pointer };
    // 接管：拿第一条指针定原位置，但作废全部——多条指针是并发采集竞态，
    // 只处理第一条会留下指向同一篇的孤儿指针。
    case 'others':
      return {
        note: state.note,
        comments: state.comments,
        existing: state.pointers[0],
        supersede: state.pointers,
      };
    default:
      return null;
  }
}

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  // 句柄要留着，不能只留 store：权限被回收后靠它一次点击就能恢复，
  // 丢了就只剩「重新选目录」这一条路。
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [collector, setCollector] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState(defaultDatasetPath());
  // 有默认值不等于使用者确认过。没确认就先把路径摆出来问一次，见 need_path。
  const [pathConfirmed, setPathConfirmed] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: 'need_root' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 「刚刚采完」与「以前采过」在 mine 状态下长得一样，必须显式区分，
  // 否则用户点完按钮看到的是一段历史记录，无法确认本次是否成功。
  const [justArchived, setJustArchived] = useState<ArchiveOutcome | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // 顶栏点「采集者」进来的改设置界面。null 表示没在改。
  const [editingCollector, setEditingCollector] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  // 判定周期序号，用来作废被新触发取代的旧周期。见 refresh。
  const genRef = useRef(0);

  const attachRoot = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensurePermission(handle))) {
      setMessage('目录授权未通过，请重新选择。');
      return;
    }
    const s = createStore(handle);
    const created = await ensureRepoTemplates(s);
    setStore(s);
    setRoot(handle);
    setRootName(handle.name);
    if (created.length > 0) setMessage(`已初始化仓库模板：${created.join('、')}`);
  }, []);

  // 恢复已保存的目录句柄与设置
  useEffect(() => {
    void (async () => {
      const st = await loadSettings(chromeLocalArea);
      setCollector(st.collector);
      const handle = await loadRootHandle();
      // 权限不够时也要把句柄收下：这里不能 requestPermission（没有用户手势），
      // 但丢掉它就会退回 need_root，让人以为目录从没选过、得重选一遍。
      if (handle) {
        setRoot(handle);
        setRootName(handle.name);
        if (await hasPermission(handle)) await attachRoot(handle);
      }
      // 存过路径 = 之前确认过，不再拦一次；没存过就保留 collected 默认值。
      if (st.datasetPath !== null) {
        setDatasetPath(st.datasetPath);
        setPathConfirmed(true);
      }
    })();
  }, [attachRoot]);

  const refresh = useCallback(async (attempt = 0, gen?: number) => {
    // 一次判定周期共用一个序号，重试沿用它。周期开始后又来了新的触发，
    // 旧周期的结果就作废——否则几个并发周期会各写各的日志和状态。
    const myGen = gen ?? ++genRef.current;
    // 任何一步抛出都会让面板静默停在旧状态，比报错更难排查，所以整体兜住。
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (myGen !== genRef.current) return;
      // 换了标签页或换了笔记，上一次的采集结果就不再是「本次」的了。
      setJustArchived(null);
      setMessage(null);

      // 每个周期都查一遍：权限会在两次判定之间被回收（关掉浏览页就会），
      // 只在挂载时查过是不够的。query 不需要用户手势，很便宜。
      const granted = store !== null && root !== null && (await hasPermission(root));
      if (myGen !== genRef.current) return;

      let diag: PageDiag | null = null;
      const next = await resolvePanelState({
        hasRoot: root !== null,
        hasPermission: granted,
        store: store ?? createStore({} as FileSystemDirectoryHandle),
        collector,
        hasDatasetPath: pathConfirmed,
        tabUrl: tab?.url ?? '',
        onDiag: (d) => { diag = d; },
        readNote: async () =>
          tab?.id === undefined
            ? {
                ok: false,
                reason: 'inject_failed',
                detail: '当前窗口没有活动标签页',
                diag: {
                  pathname: '', urlId: null, currentNoteId: null,
                  mapKeys: [], entryFound: false, commentCount: 0,
                },
              }
            : readNoteViaTab(tab.id),
      });
      if (myGen !== genRef.current) return;

      // 页面数据是异步填充的：SPA 一改 URL 就触发重读，而这篇笔记的数据往往
      // 还没填进 store。这时显示错误纯属吓人——它多半几百毫秒后就自己好了。
      // 所以先挂「读取中」，重试用尽了才把真错误摆出来。
      const transient = next.kind === 'unreadable' && isTransient(next.reason);
      if (transient && attempt < RETRY_DELAYS.length) {
        // 重试中的中间态不进日志：它几百毫秒后就会被最终结论取代，
        // 记下来只会让打开一篇笔记刷出四条。重读次数记在最终那条上。
        setState({ kind: 'reading' });
        setTimeout(() => void refreshRef.current?.(attempt + 1, myGen), RETRY_DELAYS[attempt]);
        return;
      }
      setState(next);
      pushLog(setLog, next, tab?.url ?? '', diag, attempt);
    } catch (e) {
      // 权限在这一轮判定的中途被回收（上面查过之后才掉）。这不是故障，
      // 报成 panel_error 会让人对着一句 NotAllowedError 无从下手。
      if (isPermissionError(e)) {
        setState({ kind: 'need_permission' });
        return;
      }
      // 这里兜住的是侧边栏自身的异常，不是注入失败。标成 inject_failed 会把
      // 排查方向指到扩展权限上去，而真正的原因可能在别处。
      const detail = e instanceof Error ? e.message : String(e);
      const failed: PanelState = { kind: 'unreadable', reason: 'panel_error', detail };
      setState(failed);
      pushLog(setLog, failed, '', null);
    }
  }, [store, root, collector, pathConfirmed]);

  // refresh 要在自己内部延时重调自己，用 ref 绕开闭包里的循环依赖。
  const refreshRef = useRef<((attempt?: number, gen?: number) => Promise<void>) | null>(null);
  refreshRef.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  // 切换标签页或页面内导航（modal 打开/关闭会改 URL）时重新判定
  useEffect(() => {
    const onActivated = () => { void refresh(); };
    // onUpdated 在一次导航里会触发好几次（loading、title、favicon、complete），
    // 而且别的标签页更新也会触发。不过滤的话打开一篇笔记就会跑起好几个
    // 判定周期，日志刷屏、注入也白做好几遍。
    const onUpdated = (
      _id: number,
      info: { url?: string; status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active) return;
      // 只认真正改变了「在看哪一篇」的两种变化。
      if (info.url === undefined && info.status !== 'complete') return;
      void refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh]);

  async function pickRoot() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveRootHandle(handle);
    await attachRoot(handle);
  }

  /** 必须由点击调用：requestPermission 只在用户手势里才会弹框。 */
  async function restorePermission() {
    if (!root) return;
    if (!(await ensurePermission(root))) {
      setMessage('授权未通过。也可以点顶栏的「仓库」重新选择目录。');
      return;
    }
    // 不在这里 refresh：attachRoot 里的 setStore 会重建 refresh，
    // 上面那个 effect 自然会跑一遍。手动调用只会用到闭包里的旧 store。
    await attachRoot(root);
  }

  async function saveCollector(id: string) {
    // 写入路径不再跟采集者挂钩，所以改 ID 不动路径。还没确认过路径就先别落盘——
    // 存下来会被当成「确认过」，把 need_path 那一步跳掉。
    await saveSettings(chromeLocalArea, {
      collector: id,
      datasetPath: pathConfirmed ? datasetPath : null,
    });
    setCollector(id);
    setEditingCollector(false);
  }

  async function savePath(value: string) {
    if (!collector) return;
    if (!isValidDatasetPath(value)) return;
    await saveSettings(chromeLocalArea, { collector, datasetPath: value });
    setDatasetPath(value);
    setPathConfirmed(true);
    setEditingPath(false);
  }

  async function doArchive(mode: ArchiveMode) {
    if (!store || !collector || !root) return;
    const plan = planOf(state);
    if (!plan) return;
    // 点按钮本身就是用户手势，所以这里能直接把权限要回来——权限刚被回收的
    // 常见情况下，使用者点一次「允许」就继续采，不必被打回授权页。
    // 必须赶在其他 await 之前，手势的有效期只有几秒。
    if (!(await ensurePermission(root))) {
      setMessage('目录授权已失效，采集没有开始。请重新授权后再试。');
      return;
    }
    if (!isValidDatasetPath(datasetPath)) {
      setMessage('写入路径不合法：每一段只能是小写字母、数字、连字符、下划线。');
      return;
    }
    setMessage(null);
    setProgress({ done: 0, total: plan.note.images.length });
    const res = await archive({
      store,
      note: plan.note,
      comments: plan.comments,
      collector,
      datasetPath,
      mode,
      existing: plan.existing,
      supersede: plan.supersede,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setProgress(null);
    // 路径由上面那个 effect 负责持久化，这里不再重复存一次。
    // 必须先 refresh 再记结果：refresh 会清空「本次」标记。
    await refresh();
    setJustArchived({
      mode,
      status: res.status,
      path: res.path,
      failures: res.failures,
      imageCount: plan.note.images.length,
      comments: plan.comments,
      commentImageFailures: res.commentImageFailures,
    });
  }

  const configured =
    state.kind !== 'need_root' && state.kind !== 'need_permission' &&
    state.kind !== 'need_collector' && state.kind !== 'need_path';

  return (
    <div className="panel">
      <header className="pt-top">
        <div className="pt-brand"><span className="dot" />笔记归档</div>
        {configured && (
          <>
            <button className="chip" title="更换数据仓库目录" onClick={() => void pickRoot()}>
              <span className="k">仓库</span>
              <span className="v">{rootName}</span>
            </button>
            <button className="chip" title="更改采集者 ID" onClick={() => setEditingCollector(true)}>
              <span className="k">采集者</span>
              <span className="v">{collector}</span>
            </button>
          </>
        )}
        {configured && (
          <button className="icon-btn" title="浏览数据集" onClick={() => void openBrowser()}>
            <IconBrowse />
          </button>
        )}
        <button className="icon-btn" title="重新读取页面" onClick={() => void refresh()}>
          <IconRefresh />
        </button>
      </header>

      {editingCollector ? (
        <CollectorSetup
          initial={collector}
          onSave={(id) => void saveCollector(id)}
          onCancel={() => setEditingCollector(false)}
        />
      ) : editingPath ? (
        <PathSetup
          initial={datasetPath}
          rootName={rootName}
          onSave={(value) => void savePath(value)}
          onCancel={() => setEditingPath(false)}
        />
      ) : state.kind === 'need_root' ? (
        <RootSetup onPick={() => void pickRoot()} />
      ) : state.kind === 'need_permission' ? (
        <PermissionSetup rootName={rootName} onRestore={() => void restorePermission()} />
      ) : state.kind === 'need_collector' ? (
        <CollectorSetup initial={null} onSave={(id) => void saveCollector(id)} />
      ) : state.kind === 'need_path' ? (
        <PathSetup
          initial={datasetPath}
          rootName={rootName}
          onSave={(value) => void savePath(value)}
        />
      ) : (
        <NoteView
          state={state}
          collector={collector ?? ''}
          datasetPath={datasetPath}
          onEditDatasetPath={() => setEditingPath(true)}
          onArchive={(m) => void doArchive(m)}
          progress={progress}
          message={message}
          justArchived={justArchived}
        />
      )}

      {message && !configured && <p className="hint" style={{ padding: '0 12px' }}>{message}</p>}

      <LogView log={log} onRefresh={() => void refresh()} />
    </div>
  );
}
