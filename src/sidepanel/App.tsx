import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, type Store } from '../core/store';
import { loadRootHandle, saveRootHandle, ensurePermission } from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { readNoteViaTab, type PageDiag } from '../page/read-note';
import { isTransient, resolvePanelState, type PanelState } from './usePanelState';
import { buildLogEntry, recordLog, shouldLog, type LogEntry } from './log';
import { RootSetup, CollectorSetup } from './components/Setup';
import { NoteView, type ArchiveOutcome } from './components/NoteView';
import { LogView } from './components/LogView';

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

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [collector, setCollector] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState('');
  const [state, setState] = useState<PanelState>({ kind: 'need_root' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 「刚刚采完」与「以前采过」在 mine 状态下长得一样，必须显式区分，
  // 否则用户点完按钮看到的是一段历史记录，无法确认本次是否成功。
  const [justArchived, setJustArchived] = useState<ArchiveOutcome | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
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
    setRootName(handle.name);
    if (created.length > 0) setMessage(`已初始化仓库模板：${created.join('、')}`);
  }, []);

  // 恢复已保存的目录句柄与设置
  useEffect(() => {
    void (async () => {
      const st = await loadSettings(chromeLocalArea);
      setCollector(st.collector);
      const handle = await loadRootHandle();
      if (handle && (await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
        await attachRoot(handle);
      }
      setDatasetPath(st.datasetPath ?? (st.collector ? defaultDatasetPath(st.collector) : ''));
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

      let diag: PageDiag | null = null;
      const next = await resolvePanelState({
        hasRoot: store !== null,
        store: store ?? createStore({} as FileSystemDirectoryHandle),
        collector,
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
      // 这里兜住的是侧边栏自身的异常，不是注入失败。标成 inject_failed 会把
      // 排查方向指到扩展权限上去，而真正的原因可能在别处。
      const detail = e instanceof Error ? e.message : String(e);
      const failed: PanelState = { kind: 'unreadable', reason: 'panel_error', detail };
      setState(failed);
      pushLog(setLog, failed, '', null);
    }
  }, [store, collector]);

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

  async function saveCollector(id: string) {
    const path = defaultDatasetPath(id);
    await saveSettings(chromeLocalArea, { collector: id, datasetPath: path });
    setCollector(id);
    setDatasetPath(path);
  }

  async function doArchive(mode: 'new' | 'update' | 'migrate') {
    if (!store || !collector) return;
    if (state.kind !== 'ready' && state.kind !== 'mine') return;
    if (!isValidDatasetPath(datasetPath)) {
      setMessage('写入路径不合法：每一段只能是小写字母、数字、连字符、下划线。');
      return;
    }
    setMessage(null);
    setProgress({ done: 0, total: state.note.images.length });
    const res = await archive({
      store,
      note: state.note,
      comments: state.comments,
      collector,
      datasetPath,
      mode,
      existing: state.kind === 'mine' ? state.pointer : undefined,
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setProgress(null);
    await saveSettings(chromeLocalArea, { collector, datasetPath });
    // 必须先 refresh 再记结果：refresh 会清空「本次」标记。
    await refresh();
    setJustArchived({
      mode,
      status: res.status,
      path: res.path,
      failures: res.failures,
      comments: state.comments,
      commentImageFailures: res.commentImageFailures,
    });
  }

  return (
    <main style={{ padding: 12, fontFamily: 'system-ui', fontSize: 14, lineHeight: 1.6 }}>
      <header style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        仓库：{rootName ?? '未选择'}
        {rootName && <button style={{ marginLeft: 8 }} onClick={pickRoot}>切换</button>}
      </header>

      {state.kind === 'need_root' && <RootSetup onPick={pickRoot} />}
      {state.kind === 'need_collector' && <CollectorSetup onSave={saveCollector} />}
      {state.kind !== 'need_root' && state.kind !== 'need_collector' && (
        <NoteView
          state={state}
          datasetPath={datasetPath}
          onDatasetPathChange={setDatasetPath}
          onArchive={doArchive}
          progress={progress}
          message={message}
          justArchived={justArchived}
        />
      )}
      {message && (state.kind === 'need_root' || state.kind === 'need_collector') && <p>{message}</p>}

      <LogView log={log} onRefresh={() => void refresh()} />
    </main>
  );
}
