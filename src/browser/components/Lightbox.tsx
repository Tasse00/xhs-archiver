import { useEffect, useRef, useState } from 'react';
import {
  TransformWrapper, TransformComponent, useControls, useTransformComponent,
} from 'react-zoom-pan-pinch';
import type { ImageRecord } from '../../types';
import type { NoteRef } from '../../core/browse/types';
import type { ThumbSize } from '../hooks/useThumbnail';

export type LightboxImage = Pick<ImageRecord, 'file' | 'width' | 'height' | 'bytes' | 'source_kind'>;

const MAX_SCALE = 8;

/**
 * 顶栏的缩放控件。必须放在 TransformWrapper 内部——useControls 与
 * useTransformComponent 都从它的 context 取值，摆在外面拿不到。
 */
function ZoomControls({ fitRatio }: { fitRatio: number | null }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const scale = useTransformComponent((c) => c.state.scale);
  // 库的 scale=1 是「完整显示」而不是原始像素（fit 由 CSS 的 object-fit 负责），
  // 所以要乘上 fit 比例才是使用者理解的那个百分比。
  const percent = fitRatio === null ? null : Math.round(scale * fitRatio * 100);
  return (
    <span className="bw-lb-zoom">
      <button onClick={() => zoomOut()} title="缩小">−</button>
      <b>{percent === null ? '—' : `${percent}%`}</b>
      <button onClick={() => zoomIn()} title="放大">+</button>
      <button onClick={() => resetTransform()} title="完整显示">⤢</button>
    </span>
  );
}

/**
 * 换了图就复位。不复位的话上一张放大到 400% 的状态会原样套到下一张身上，
 * 翻图翻到一半会突然看到某张图的局部。
 */
function ResetOnChange({ token }: { token: string }) {
  const { resetTransform } = useControls();
  useEffect(() => { resetTransform(0); }, [token, resetTransform]);
  return null;
}

export function Lightbox({
  noteRef, images, index, onIndex, onClose, thumbUrl,
}: {
  noteRef: NoteRef;
  images: LightboxImage[];
  index: number;
  onIndex(i: number): void;
  onClose(): void;
  thumbUrl(ref: NoteRef, file: string, size: ThumbSize): string | undefined;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      if (e.key === 'ArrowRight') onIndex(Math.min(images.length - 1, index + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onIndex, onClose]);

  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cur = images[index];
  // 只有看图器会解原图。它用独立的 LRU(3)，退出后很快被挤掉释放
  const url = cur ? thumbUrl(noteRef, cur.file, 'full') : undefined;

  // 换图时上一张的自然尺寸必须作废，否则百分比会短暂显示上一张的换算结果
  useEffect(() => { setNat(null); }, [url]);

  // 尺寸只能取 naturalWidth：同一个看图器也被评论配图复用，而评论图在
  // comments.json 里记的是展示尺寸（284×367 的图实际 556×717），
  // 拿 ImageRecord 的声明值算，评论图会整批算错。
  const fitRatio = box && nat ? Math.min(box.w / nat.w, box.h / nat.h) : null;

  return (
    <div className="bw-lightbox" onClick={onClose}>
      {/* TransformWrapper 只返回 Context.Provider，不渲染任何 DOM 元素，
          所以夹在这里不会破坏 .bw-lightbox 的 flex 布局。 */}
      <TransformWrapper
        minScale={1}
        maxScale={MAX_SCALE}
        limitToBounds
        centerOnInit
        doubleClick={{ mode: 'toggle' }}
        wheel={{ step: 0.2 }}
      >
        <div className="bw-lb-bar">
          <span>{index + 1} / {images.length}</span>
          <span>{cur ? `${cur.width}×${cur.height} · ${(cur.bytes / 1024).toFixed(0)} KB · ${cur.source_kind}` : ''}</span>
          <ZoomControls fitRatio={fitRatio} />
          <span>← → 翻图 · 滚轮缩放 · 双击放大 · Esc 退出</span>
        </div>
        <div className="bw-lb-img" ref={boxRef} onClick={(e) => e.stopPropagation()}>
          {url ? (
            <>
              <ResetOnChange token={url} />
              <TransformComponent
                // 库给 wrapper 和 content 的默认值是 width/height: fit-content，
                // 两层都按内容收缩、不填满父容器。不覆盖成 100%，img 的
                // max-height 就又失去参照，等于把这次要修的 bug 原样重演一遍。
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%' }}
              >
                <img
                  src={url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onLoad={(e) => setNat({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })}
                />
              </TransformComponent>
            </>
          ) : (
            <p className="bw-empty">正在解码…</p>
          )}
        </div>
      </TransformWrapper>
    </div>
  );
}
