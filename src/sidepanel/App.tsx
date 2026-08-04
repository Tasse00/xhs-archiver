import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, type Store } from '../core/store';
import { loadRootHandle, saveRootHandle, ensurePermission } from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { readNoteViaTab, type PageDiag } from '../page/read-note';
import { isTransient, resolvePanelState, type PanelState } from './usePanelState';
import { appendLog, buildLogEntry, type LogEntry } from './log';
import { RootSetup, CollectorSetup } from './components/Setup';
import { NoteView, type ArchiveOutcome } from './components/NoteView';
import { LogView } from './components/LogView';

/** 重读的间隔，递增。用尽了才认定是真失败。 */
const RETRY_DELAYS = [300, 700, 1500];

function pushLog(
  setLog: (fn: (prev: LogEntry[]) => LogEntry[]) => void,
  state: PanelState,
  tabUrl: string,
  diag: PageDiag | null,
) {
  setLog((prev) => appendLog(prev, buildLogEntry(state, tabUrl, diag, new Date())));
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

  const refresh = useCallback(async (attempt = 0) => {
    // 任何一步抛出都会让面板静默停在旧状态，比报错更难排查，所以整体兜住。
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
                diag: { pathname: '', urlId: null, currentNoteId: null, mapKeys: [], entryFound: false },
              }
            : readNoteViaTab(tab.id),
      });
      // 日志始终记真实判定结果，排查时不能丢掉中间态。
      pushLog(setLog, next, tab?.url ?? '', diag);

      // 页面数据是异步填充的：SPA 一改 URL 就触发重读，而这篇笔记的数据往往
      // 还没填进 store。这时显示错误纯属吓人——它多半几百毫秒后就自己好了。
      // 所以先挂「读取中」，重试用尽了才把真错误摆出来。
      const transient = next.kind === 'unreadable' && isTransient(next.reason);
      if (transient && attempt < RETRY_DELAYS.length) {
        setState({ kind: 'reading' });
        setTimeout(() => void refreshRef.current?.(attempt + 1), RETRY_DELAYS[attempt]);
        return;
      }
      setState(next);
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
  const refreshRef = useRef<((attempt?: number) => Promise<void>) | null>(null);
  refreshRef.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  // 切换标签页或页面内导航（modal 打开/关闭会改 URL）时重新判定
  useEffect(() => {
    const onChange = () => { void refresh(); };
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener(onChange);
    return () => {
      chrome.tabs.onActivated.removeListener(onChange);
      chrome.tabs.onUpdated.removeListener(onChange);
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
    setJustArchived({ mode, status: res.status, path: res.path, failures: res.failures });
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
