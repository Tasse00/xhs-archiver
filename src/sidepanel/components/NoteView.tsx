import type { ExtractedNote } from '../../types';
import type { PanelState } from '../usePanelState';

/** 本次会话刚完成的一次采集，仅在结果仍对应当前笔记时存在。 */
export interface ArchiveOutcome {
  mode: 'new' | 'update' | 'migrate';
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
}

/**
 * 很多笔记的 title 本来就是空的，正文首行才是页面上看到的那句话。
 * 一律显示「(无标题)」会让人以为读错了笔记。
 */
function displayTitle(note: ExtractedNote): { text: string; fromContent: boolean } {
  if (note.title) return { text: note.title, fromContent: false };
  const firstLine = note.content.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  if (!firstLine) return { text: '(无标题、无正文)', fromContent: false };
  return {
    text: firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine,
    fromContent: true,
  };
}

function NoteTitle({ note }: { note: ExtractedNote }) {
  const { text, fromContent } = displayTitle(note);
  return (
    <h3 style={{ marginBottom: 4 }}>
      {text}
      {fromContent && (
        <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.6 }}>（无标题，取自正文）</span>
      )}
    </h3>
  );
}

export function NoteView({
  state, datasetPath, onDatasetPathChange, onArchive, progress, message, justArchived,
}: {
  state: PanelState;
  datasetPath: string;
  onDatasetPathChange(v: string): void;
  onArchive(mode: 'new' | 'update' | 'migrate'): void;
  progress: { done: number; total: number } | null;
  message: string | null;
  justArchived: ArchiveOutcome | null;
}) {
  if (state.kind === 'reading') return <p style={{ opacity: 0.7 }}>正在读取页面数据…</p>;
  if (state.kind === 'not_xhs') return <p>当前标签页不是小红书。</p>;
  if (state.kind === 'not_note') return <p>请打开一篇笔记后再采集。</p>;
  if (state.kind === 'unreadable') {
    const hints: Record<typeof state.reason, string> = {
      inject_failed: '注入页面脚本失败，多为扩展权限或页面尚未就绪，重新加载扩展后再试。',
      page_error: '脚本在页面里执行时出错，详情见下方工作日志。',
      panel_error: '侧边栏自己出错了，与页面无关，详情见下方工作日志。',
      no_state: '页面上没有小红书的全局数据，请确认已登录并刷新页面。',
      no_note: '页面上找不到当前这篇笔记的数据，请重新打开这篇笔记。',
      incomplete_data: '这篇笔记的数据还没加载完整，稍等一下或刷新页面重试。',
    };
    return (
      <section>
        <p>读不到页面数据（{state.reason}）。{hints[state.reason]}</p>
        {state.detail && <p style={{ fontSize: 12, opacity: 0.7 }}><code>{state.detail}</code></p>}
      </section>
    );
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

  if (justArchived) {
    const verb = justArchived.mode === 'new' ? '采集' : justArchived.mode === 'update' ? '更新' : '迁移';
    return (
      <section>
        <NoteTitle note={note} />
        {justArchived.status === 'complete' ? (
          <div style={{ padding: 8, background: 'rgba(0,160,60,0.12)', borderRadius: 4 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>✓ 本次{verb}完成</p>
            <p style={{ margin: '4px 0 0' }}><code>{justArchived.path}</code></p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>
              {note.images.length} 张图已写入。记得在数据仓库里提交这次改动。
            </p>
          </div>
        ) : (
          <div style={{ padding: 8, background: 'rgba(200,60,0,0.12)', borderRadius: 4 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>✗ 本次{verb}未完成，索引未写入</p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>{justArchived.failures.join('；')}</p>
          </div>
        )}
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          切换到别的笔记后，这条提示会消失。
        </p>
      </section>
    );
  }

  return (
    <section>
      <NoteTitle note={note} />
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
