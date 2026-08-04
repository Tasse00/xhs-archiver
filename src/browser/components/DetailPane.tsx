import { useEffect, useState } from 'react';
import { loadComments, type CommentsResult } from '../../core/browse/comments';
import { checkQuality, type QualityReport } from '../../core/browse/quality';
import type { NoteDetail, NoteRef, RowMeta } from '../../core/browse/types';
import { noteKeyOf } from '../../core/browse/scope';
import type { ReadStore } from '../../core/read-store';
import type { CommentRecord } from '../../types';
import type { ThumbSize } from '../hooks/useThumbnail';
import { Lightbox, type LightboxImage } from './Lightbox';

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

const COMMENT_TAG_TEXT: Record<string, string> = {
  is_author: '作者',
  user_top: '置顶',
};

function commentTime(iso: string): string {
  return iso.length >= 16 ? iso.slice(5, 16).replace('T', ' ') : iso;
}

function authorInitial(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? '·';
}

export function CommentCard({
  comment, noteRef, thumbUrl, onOpenImages, isReply = false,
}: {
  comment: CommentRecord;
  noteRef: NoteRef;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
  onOpenImages(images: LightboxImage[], index: number): void;
  isReply?: boolean;
}) {
  const replies = comment.sub_comments ?? [];
  const replyTotal = Math.max(comment.sub_comment_count ?? 0, replies.length);

  return (
    <article className={`bw-comment-card${isReply ? ' reply' : ''}`}>
      <div className="bw-comment-avatar" aria-hidden="true">{authorInitial(comment.author.nickname)}</div>
      <div className="bw-comment-main">
        <header className="bw-comment-line">
          <span className="bw-comment-author">{comment.author.nickname}</span>
          {comment.tags.map((tag) => (
            <span className={`bw-comment-tag ${tag}`} key={tag}>{COMMENT_TAG_TEXT[tag] ?? tag}</span>
          ))}
        </header>

        <p className={`bw-comment-content${comment.content ? '' : ' empty'}`}>
          {comment.content || '无文字内容'}
        </p>

        {comment.images.length > 0 && (
          <div className="bw-comment-images">
            {comment.images.map((img, index) => {
              const url = thumbUrl(noteRef, img.file, 320);
              return (
                <button
                  type="button"
                  className="bw-comment-image"
                  key={img.file}
                  onClick={() => onOpenImages(comment.images, index)}
                  aria-label={`查看评论配图 ${index + 1} / ${comment.images.length}`}
                >
                  {url ? <img src={url} alt="" /> : <span>图片</span>}
                </button>
              );
            })}
          </div>
        )}

        <footer className="bw-comment-meta">
          <span>{commentTime(comment.published_at)}</span>
          {comment.ip_location && <span>IP {comment.ip_location}</span>}
          {comment.liked_count > 0 && <span className="bw-comment-likes">♥ {comment.liked_count.toLocaleString()}</span>}
        </footer>

        {!isReply && replyTotal > 0 && (
          <div className="bw-comment-thread">
            {replies.map((reply) => (
              <CommentCard
                key={reply.id}
                comment={reply}
                noteRef={noteRef}
                thumbUrl={thumbUrl}
                onOpenImages={onOpenImages}
                isReply
              />
            ))}
            {replyTotal > replies.length && (
              <div className="bw-comment-reply-count">已收录 {replies.length} / {replyTotal} 条回复</div>
            )}
          </div>
        )}
      </div>
    </article>
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
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

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
              onClick={() => setLightbox({ images: detail.images, index: i })}
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

        <section className="bw-comments">
          {comments.kind === 'none' && <p className="bw-comments-empty">未采集评论</p>}
          {comments.kind === 'error' && <p className="bw-note bad">{comments.reason}</p>}
          {comments.kind === 'ok' && (
            <>
              <header className="bw-comments-head">
                <div>
                  <strong>评论</strong>
                  <span>{comments.file.collected_count.toLocaleString()} / {comments.file.declared_total.toLocaleString()} 已采集</span>
                </div>
                <span className={`bw-comments-state${comments.file.complete ? ' complete' : ''}`}>
                  {comments.file.complete ? '完整' : '页面已加载部分'}
                </span>
              </header>
              <div className="bw-comments-progress" aria-hidden="true">
                <i style={{ width: `${Math.min(100, comments.file.declared_total === 0 ? 100 : comments.file.collected_count / comments.file.declared_total * 100)}%` }} />
              </div>
              <div className="bw-comment-list">
                {comments.file.comments.map((comment) => (
                  <CommentCard
                    key={comment.id}
                    comment={comment}
                    noteRef={noteRef}
                    thumbUrl={thumbUrl}
                    onOpenImages={(images, index) => setLightbox({ images, index })}
                  />
                ))}
                {comments.file.comments.length === 0 && <p className="bw-comments-empty">评论文件中没有已加载内容</p>}
              </div>
            </>
          )}
        </section>
      </div>

      {lightbox !== null && (
        <Lightbox
          noteRef={noteRef}
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(index) => setLightbox((current) => current ? { ...current, index } : null)}
          onClose={() => setLightbox(null)}
          thumbUrl={thumbUrl}
        />
      )}
    </aside>
  );
}
