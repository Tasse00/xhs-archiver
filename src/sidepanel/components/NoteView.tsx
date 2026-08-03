import type { PanelState } from '../usePanelState';

export function NoteView({
  state, datasetPath, onDatasetPathChange, onArchive, progress, message,
}: {
  state: PanelState;
  datasetPath: string;
  onDatasetPathChange(v: string): void;
  onArchive(mode: 'new' | 'update' | 'migrate'): void;
  progress: { done: number; total: number } | null;
  message: string | null;
}) {
  if (state.kind === 'not_xhs') return <p>当前标签页不是小红书。</p>;
  if (state.kind === 'not_note') return <p>请打开一篇笔记后再采集。</p>;
  if (state.kind === 'unreadable') {
    return <p>读不到页面数据（{state.reason}）。请确认已登录小红书，并刷新页面重试。</p>;
  }
  if (state.kind === 'video_rejected') return <p>这是一篇视频笔记，本工具不采集视频。</p>;

  if (state.kind === 'blocked_by_other') {
    return (
      <section>
        <p>这篇已被他人采集，不重复采集。</p>
        <ul>
          {state.pointers.map((p) => (
            <li key={p.collector}>
              <b>{p.collector}</b> 于 {p.last_archived_at} 采集<br />
              <code>{p.path}</code>
            </li>
          ))}
        </ul>
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          若对方数据有问题需要接管，删除对应的 <code>_index</code> 指针文件即可解除。
        </p>
      </section>
    );
  }

  const note = state.kind === 'mine' || state.kind === 'ready' ? state.note : null;
  if (!note) return null;

  return (
    <section>
      <h3>{note.title || '(无标题)'}</h3>
      <p style={{ fontSize: 12 }}>
        {note.images.length} 张图 · 赞 {note.interact.liked} · 藏 {note.interact.collected}
      </p>

      <label>
        写入路径
        <input value={datasetPath} onChange={(e) => onDatasetPathChange(e.target.value)} />
      </label>

      {state.kind === 'mine' && (
        <>
          <p>
            你已于 {state.pointer.last_archived_at} 采集过，位于 <code>{state.pointer.path}</code>
          </p>
          {state.duplicates.length > 0 && (
            <p style={{ color: 'darkorange' }}>
              这篇存在 {state.duplicates.length + 1} 份重复采集：
              {state.duplicates.map((d) => d.path).join('、')}
            </p>
          )}
          <button onClick={() => onArchive('update')}>更新原位置</button>
          <button onClick={() => onArchive('migrate')}>
            迁移到当前路径（将删除 {state.pointer.path}）
          </button>
        </>
      )}

      {state.kind === 'ready' && <button onClick={() => onArchive('new')}>采集这篇</button>}

      {progress && <p>下载中 {progress.done}/{progress.total}</p>}
      {message && <p>{message}</p>}
    </section>
  );
}
