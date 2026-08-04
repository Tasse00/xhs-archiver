import { useEffect, useState } from 'react';
import { loadComments, type CommentsResult } from '../../core/browse/comments';
import { checkQuality, type QualityReport } from '../../core/browse/quality';
import type { NoteDetail, NoteRef, RowMeta } from '../../core/browse/types';
import { noteKeyOf } from '../../core/browse/scope';
import type { ReadStore } from '../../core/read-store';
import type { CommentRecord } from '../../types';
import type { ThumbSize } from '../hooks/useThumbnail';
import { Lightbox } from './Lightbox';

function qualityText(q: QualityReport): { tone: string; text: string } | null {
  switch (q.state.kind) {
    case 'ok':
      return null;
    case 'no_pointer':
      return { tone: 'warn', text: '当前目录没有对应的索引指针' };
    case 'pointer_elsewhere':
      return { tone: 'warn', text: `索引里这篇指向 ${q.state.paths.join('、')}，当前目录是遗留副本` };
    case 'race_diverged':
      return { tone: 'bad', text: `${q.state.pointers.length} 个采集者的指针指向不同目录，需人工清理` };
    case 'race_same_path':
      return { tone: 'warn', text: `${q.state.collectors.join('、')} 都登记了这份数据` };
    case 'invariant_broken':
      return { tone: 'bad', text: `指针存在但数据不完整，缺：${q.state.missing.join('、')}` };
  }
}

function Comment({ c, depth }: { c: CommentRecord; depth: number }) {
  return (
    <>
      <div className="bw-cmt" style={{ paddingLeft: depth * 14 }}>
        <b>{c.author.nickname}</b>
        {c.content && <span>：{c.content}</span>}
        {c.images.length > 0 && <span className="bw-dim">［{c.images.length} 张配图］</span>}
        <span className="bw-dim"> ❤ {c.liked_count}</span>
      </div>
      {(c.sub_comments ?? []).map((s) => <Comment key={s.id} c={s} depth={depth + 1} />)}
    </>
  );
}

export function DetailPane({
  store, noteRef, meta, detail, onClose, thumbUrl,
}: {
  store: ReadStore;
  noteRef: NoteRef;
  meta: RowMeta;
  detail: NoteDetail;
  onClose(): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
}) {
  const [comments, setComments] = useState<CommentsResult>({ kind: 'none' });
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const key = noteKeyOf(noteRef);
  useEffect(() => {
    let alive = true;
    setComments({ kind: 'none' });
    setQuality(null);
    void loadComments(store, noteRef).then((r) => { if (alive) setComments(r); });
    void checkQuality(store, noteRef, detail).then((r) => { if (alive) setQuality(r); });
    return () => { alive = false; };
  }, [store, key, detail, noteRef]);

  const q = quality ? qualityText(quality) : null;
  const missing = quality?.missingImages ?? [];

  return (
    <aside className="bw-detail">
      <div className="bw-detail-bar">
        <span className="bw-dim">{meta.title || '（无标题）'}</span>
        <button className="bw-btn" onClick={onClose}>✕</button>
      </div>

      <div className="bw-detail-body">
        <div className="bw-thumbs">
          {detail.images.map((img, i) => (
            <span
              key={img.file}
              className={`bw-thumb${missing.includes(img.file) ? ' missing' : ''}`}
              onClick={() => setLightbox(i)}
            >
              {(() => {
                const u = missing.includes(img.file) ? undefined : thumbUrl(noteRef, img.file, 320);
                return u ? <img src={u} alt="" /> : null;
              })()}
            </span>
          ))}
          {detail.images.length === 0 && <p className="bw-empty">没有图片</p>}
        </div>

        {missing.length > 0 && <p className="bw-note bad">{missing.length} 张图片文件缺失</p>}
        {q && <p className={`bw-note ${q.tone}`}>{q.text}</p>}

        <h3>{meta.title || '（无标题）'}</h3>
        <p className="bw-content">{meta.content}</p>
        {meta.tags.length > 0 && <p className="bw-dim">{meta.tags.map((t) => `#${t}`).join(' ')}</p>}

        <p>👤 {detail.author.nickname}</p>
        <p>❤ {meta.liked} &nbsp; ⭐ {meta.collected} &nbsp; 💬 {meta.comment} &nbsp; ↗ {meta.share}</p>
        <p className="bw-dim">
          发布 {meta.publishedAt.slice(0, 16).replace('T', ' ')}
          {meta.lastEditedAt !== meta.publishedAt && ` · 编辑 ${meta.lastEditedAt.slice(0, 16).replace('T', ' ')}`}
          {detail.ipLocation && ` · IP ${detail.ipLocation}`}
        </p>
        <p className="bw-dim">
          {meta.collector} 采集 · {meta.lastArchivedAt.slice(0, 16).replace('T', ' ')}
          · 第 {meta.archiveCount} 次 · {key}/
        </p>

        <hr />
        {comments.kind === 'none' && <p className="bw-dim">未采集评论</p>}
        {comments.kind === 'error' && <p className="bw-note bad">{comments.reason}</p>}
        {comments.kind === 'ok' && (
          <>
            <p>
              <b>评论 {comments.file.collected_count} / {comments.file.declared_total}</b>
              <span className="bw-dim">（采集时页面只加载了这些）</span>
            </p>
            {comments.file.comments.map((c) => <Comment key={c.id} c={c} depth={0} />)}
          </>
        )}
      </div>

      {lightbox !== null && (
        <Lightbox
          noteRef={noteRef}
          images={detail.images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          thumbUrl={thumbUrl}
        />
      )}
    </aside>
  );
}
