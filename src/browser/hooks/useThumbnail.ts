import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lru } from '../../core/browse/lru';
import { TaskQueue } from '../../core/browse/queue';
import { noteKeyOf } from '../../core/browse/scope';
import type { NoteRef } from '../../core/browse/types';
import type { ReadStore } from '../../core/read-store';

const THUMB_MAX = 300;
/** 原图几 MB 一张，和缩略图共用一张 300 条的表会一直占着内存不放 */
const FULL_MAX = 3;
const CONCURRENCY = 6;

export type ThumbSize = 96 | 320 | 'full';

/**
 * 缩到目标宽度后立刻丢掉原始 blob。原图 2~5 MB，解码后占内存十几倍，
 * 不缩就撑不过几屏。
 */
async function decode(file: File, size: ThumbSize): Promise<string> {
  if (size === 'full') return URL.createObjectURL(file);
  const bmp = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'low' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }));
}

export function useThumbnail(store: ReadStore | null) {
  // tick 只用来触发重渲染：缓存本身在 ref 里，不能进 state（每帧新对象会打爆渲染）
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const thumbs = useMemo(
    () => new Lru<string>({ max: THUMB_MAX, onEvict: (u) => URL.revokeObjectURL(u) }),
    [],
  );
  const fulls = useMemo(
    () => new Lru<string>({ max: FULL_MAX, onEvict: (u) => URL.revokeObjectURL(u) }),
    [],
  );
  const queue = useMemo(() => new TaskQueue(CONCURRENCY), []);
  const inflight = useRef(new Set<string>());
  const wanted = useRef(new Set<string>());

  const releaseAll = useCallback(() => {
    queue.clearPending();
    thumbs.clear();
    fulls.clear();
    wanted.current.clear();
  }, [queue, thumbs, fulls]);

  useEffect(() => releaseAll, [releaseAll]);

  const thumbUrl = useCallback(
    (ref: NoteRef, file: string, size: ThumbSize): string | undefined => {
      const key = `${noteKeyOf(ref)}::${file}::${size}`;
      const table = size === 'full' ? fulls : thumbs;
      const hit = table.get(key);
      if (hit !== undefined) return hit;
      if (inflight.current.has(key) || store === null) return undefined;

      inflight.current.add(key);
      wanted.current.add(key);
      queue.push(
        async () => {
          const f = await store.readFile(`${noteKeyOf(ref)}/${file}`);
          return f === null ? null : await decode(f, size);
        },
        () => !wanted.current.has(key),
        (o) => {
          inflight.current.delete(key);
          if (o.kind === 'stale' && o.value !== null) {
            // 读已经开始了，中止不了；拿到手立刻释放，否则就是泄漏
            URL.revokeObjectURL(o.value);
            return;
          }
          if (o.kind === 'done' && o.value !== null) {
            table.set(key, o.value);
            bump();
          }
        },
      );
      return undefined;
    },
    [store, queue, thumbs, fulls, bump],
  );

  /** 滚出视口就别做了。已经开始的读取会在完成时按 stale 释放掉 */
  const forget = useCallback((ref: NoteRef, file: string, size: ThumbSize) => {
    wanted.current.delete(`${noteKeyOf(ref)}::${file}::${size}`);
  }, []);

  return { thumbUrl, forget, releaseAll };
}
