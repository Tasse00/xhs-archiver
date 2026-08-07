import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { noteKeyOf, type SortKey } from '../../core/browse/scope';
import type { Sort } from '../../core/browse/search';
import type { NoteRef, RowState } from '../../core/browse/types';
import { visibleRange } from '../../core/browse/virtual';
import type { ThumbSize } from '../hooks/useThumbnail';

export const ROW_H = 44;
const OVERSCAN = 8;
const THUMB: ThumbSize = 96;

function num(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** 没采到作者信息时显示破折号。写 0 会让人以为这个号真的零粉丝。 */
function numOrDash(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('zh-CN');
}

function Cover({ url }: { url: string | undefined }) {
  return <span className="bw-cover">{url ? <img src={url} alt="" /> : null}</span>;
}

export function Table({
  refs, stateOf, request, thumbUrl, forget, wide, selectedKey, onSelect,
  sort, onSort, showCommentCol, commentCount,
}: {
  refs: NoteRef[];
  stateOf(ref: NoteRef): RowState;
  request(ref: NoteRef): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
  forget(ref: NoteRef, file: string, size: ThumbSize): void;
  wide: boolean;
  selectedKey: string | null;
  onSelect(ref: NoteRef): void;
  sort: Sort;
  onSort(key: SortKey): void;
  showCommentCol: boolean;
  commentCount(ref: NoteRef): number | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const shown = useRef<NoteRef[]>([]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const { start, end } = visibleRange(scrollTop, height, ROW_H, refs.length, OVERSCAN);
  const slice = refs.slice(start, end);

  // 进视口就读元数据；滚出去的告诉缩略图层别做了
  useEffect(() => {
    for (const r of slice) request(r);
    const now = new Set(slice.map(noteKeyOf));
    for (const old of shown.current) {
      if (now.has(noteKeyOf(old))) continue;
      const st = stateOf(old);
      if (st.kind === 'ready' && st.meta.coverFile) forget(old, st.meta.coverFile, THUMB);
    }
    shown.current = slice;
  });

  const th = (key: SortKey, label: string, cls: string) => (
    <span
      className={`${cls} th${sort.key === key ? ' on' : ''}`}
      onClick={() => onSort(key)}
    >
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </span>
  );

  return (
    <div className="bw-table">
      <div className={`bw-head${wide ? ' wide' : ''}`}>
        <span className="c-cover" />
        {th('title', '标题', 'c-title')}
        {th('authorNickname', '作者', 'c-author')}
        {th('authorFans', '粉丝', 'c-fans')}
        {th('authorInteraction', '获赞藏', 'c-fans')}
        {th('liked', '赞', 'c-num')}
        {th('collected', '藏', 'c-num')}
        {th('comment', '评', 'c-num')}
        {showCommentCol && <span className="c-num">已采</span>}
        {wide && th('share', '享', 'c-num')}
        {wide && th('imageCount', '图片', 'c-num')}
        {wide && th('collector', '采集者', 'c-author')}
        {th('lastArchivedAt', '采集时间', 'c-time')}
        {wide && <span className="c-path">落盘路径</span>}
      </div>

      <div className="bw-scroll" ref={box} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: refs.length * ROW_H, position: 'relative' }}>
          {slice.map((ref, i) => {
            const key = noteKeyOf(ref);
            const st = stateOf(ref);
            const top = (start + i) * ROW_H;
            const cls = `bw-row${wide ? ' wide' : ''}${selectedKey === key ? ' on' : ''}`;

            if (st.kind === 'error') {
              return (
                <div key={key} className={`${cls} err`} style={{ top }} onClick={() => onSelect(ref)}>
                  <span className="c-cover" />
                  <span className="c-title">读取失败：{st.reason}</span>
                  <span className="c-path">{key}</span>
                </div>
              );
            }
            if (st.kind === 'pending') {
              return (
                <div key={key} className={`${cls} dim`} style={{ top }}>
                  <span className="c-cover" />
                  <span className="c-title">…</span>
                </div>
              );
            }

            const m = st.meta;
            return (
              <div key={key} className={cls} style={{ top }} onClick={() => onSelect(ref)}>
                <Cover url={m.coverFile ? thumbUrl(ref, m.coverFile, THUMB) : undefined} />
                <span className="c-title" title={m.title}>{m.title || '（无标题）'}</span>
                <span className="c-author" title={m.authorNickname}>{m.authorNickname}</span>
                <span className="c-fans">{numOrDash(m.authorFans)}</span>
                <span className="c-fans">{numOrDash(m.authorInteraction)}</span>
                <span className="c-num">{num(m.liked)}</span>
                <span className="c-num">{num(m.collected)}</span>
                <span className="c-num">{num(m.comment)}</span>
                {showCommentCol && <span className="c-num">{commentCount(ref) ?? '…'}</span>}
                {wide && <span className="c-num">{num(m.share)}</span>}
                {wide && <span className="c-num">{m.imageCount}</span>}
                {wide && <span className="c-author">{m.collector}</span>}
                <span className="c-time">{m.lastArchivedAt.slice(5, 16).replace('T', ' ')}</span>
                {wide && <span className="c-path" title={m.datasetPath}>{m.datasetPath}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bw-foot">↑↓ 换行 · Enter 开详情 · 共 {refs.length} 篇</div>
    </div>
  );
}
