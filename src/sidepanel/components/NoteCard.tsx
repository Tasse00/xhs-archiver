import type { ExtractedComments, ExtractedNote } from '../../types';

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

/** 归档时间戳带时区，界面上只要「几月几号几点」。 */
function shortTime(iso: string): string {
  return iso.slice(5, 16).replace('T', ' ');
}

/**
 * 只采页面已加载的评论，所以「18 / 96」是常态而非故障。把差额画成进度条，
 * 一行数字容易被略过，一条没填满的槽不会。
 */
function CommentMeter({ c }: { c: ExtractedComments }) {
  if (c.declaredTotal === 0 && c.collectedCount === 0) {
    return <div className="sect-h">这篇没有评论</div>;
  }
  const pct = c.declaredTotal === 0 ? 100 : Math.round((c.collectedCount / c.declaredTotal) * 100);
  return (
    <div>
      <div className="sect-h">
        评论 <b>{c.collectedCount} / {c.declaredTotal}</b>
        <span className="push">已加载 {Math.min(pct, 100)}%</span>
      </div>
      <div className={c.complete ? 'meter is-full' : 'meter'}>
        <i style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {!c.complete && (
        <p className="hint">只采页面已经加载出来的那部分。想多采就在页面里往下翻，翻到哪采到哪。</p>
      )}
    </div>
  );
}

export function NoteCard({ note, comments }: { note: ExtractedNote; comments: ExtractedComments }) {
  const { text, fromContent } = displayTitle(note);
  return (
    <>
      <div>
        <h1 className="note-title">
          {text}
          {fromContent && <span className="src">取自正文</span>}
        </h1>
        <div className="note-by">
          <span>@{note.author.nickname}</span>
          <span className="sep">·</span>
          <span>{shortTime(note.publishedAt)} 发布</span>
          {/* 从未编辑过时 lastEditedAt 与 publishedAt 只差不到一秒，没必要重复显示 */}
          {note.lastEditedAt.slice(0, 16) !== note.publishedAt.slice(0, 16) && (
            <>
              <span className="sep">·</span>
              <span>{shortTime(note.lastEditedAt)} 编辑</span>
            </>
          )}
        </div>
      </div>

      <div className="stats">
        <div><b>{note.images.length}</b><span>图</span></div>
        <div><b>{note.interact.liked.toLocaleString()}</b><span>赞</span></div>
        <div><b>{note.interact.collected.toLocaleString()}</b><span>收藏</span></div>
        <div><b>{note.interact.comment.toLocaleString()}</b><span>评论</span></div>
      </div>

      {note.tags.length > 0 && (
        <div className="tags">
          {note.tags.map((t) => <span className="tag" key={t}>#{t}</span>)}
        </div>
      )}

      <CommentMeter c={comments} />
    </>
  );
}
