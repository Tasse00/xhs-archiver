import { useEffect } from 'react';
import type { ImageRecord } from '../../types';
import type { NoteRef } from '../../core/browse/types';
import type { ThumbSize } from '../hooks/useThumbnail';

export function Lightbox({
  noteRef, images, index, onIndex, onClose, thumbUrl,
}: {
  noteRef: NoteRef;
  images: ImageRecord[];
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

  const cur = images[index];
  // 只有看图器会解原图。它用独立的 LRU(3)，退出后很快被挤掉释放
  const url = cur ? thumbUrl(noteRef, cur.file, 'full') : undefined;

  return (
    <div className="bw-lightbox" onClick={onClose}>
      <div className="bw-lb-bar">
        <span>{index + 1} / {images.length}</span>
        <span>{cur ? `${cur.width}×${cur.height} · ${(cur.bytes / 1024).toFixed(0)} KB · ${cur.source_kind}` : ''}</span>
        <span>← → 翻图 · Esc 退出</span>
      </div>
      <div className="bw-lb-img" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt="" /> : <p className="bw-empty">正在解码…</p>}
      </div>
    </div>
  );
}
