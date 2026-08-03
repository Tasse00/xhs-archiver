import { useCallback, useEffect, useState } from 'react';
import { createStore, type Store } from '../core/store';
import { loadRootHandle, saveRootHandle, ensurePermission } from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { readNoteViaTab } from '../page/read-note';
import { resolvePanelState, type PanelState } from './usePanelState';
import { RootSetup, CollectorSetup } from './components/Setup';
import { NoteView } from './components/NoteView';

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [collector, setCollector] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState('');
  const [state, setState] = useState<PanelState>({ kind: 'need_root' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    setState(
      await resolvePanelState({
        hasRoot: store !== null,
        store: store ?? createStore({} as FileSystemDirectoryHandle),
        collector,
        tabUrl: tab?.url ?? '',
        readNote: () => readNoteViaTab(tab!.id!),
      }),
    );
  }, [store, collector]);

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
    setMessage(
      res.status === 'complete'
        ? `已采集到 ${res.path}`
        : `部分失败，未写入索引：${res.failures.join('；')}`,
    );
    await saveSettings(chromeLocalArea, { collector, datasetPath });
    await refresh();
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
        />
      )}
      {message && (state.kind === 'need_root' || state.kind === 'need_collector') && <p>{message}</p>}
    </main>
  );
}
