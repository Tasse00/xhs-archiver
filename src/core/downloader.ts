import type { ExtractedImage, SourceKind } from '../types';
import { candidatesFor, extensionFor, isDecodable } from './image-source';

export interface Deps {
  fetch: typeof fetch;
  decode(b: Blob): Promise<{ width: number; height: number }>;
  sha256(b: ArrayBuffer): Promise<string>;
}

export interface FetchedImage {
  bytes: Uint8Array;
  ext: string;
  sourceKind: SourceKind;
  sourceUrl: string;
  width: number;
  height: number;
  sha256: string;
}

export const defaultDeps: Deps = {
  fetch: (...a) => fetch(...a),
  async decode(b) {
    const bmp = await createImageBitmap(b);
    const dim = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dim;
  },
  async sha256(buf) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  },
};

/**
 * 按候选顺序尝试，返回第一个可用的。
 * 原图必须通过尺寸校验；HEIC 无法在 Chrome 中解码，直接跳过改用降级图。
 */
export async function downloadImage(img: ExtractedImage, deps: Deps): Promise<FetchedImage> {
  const reasons: string[] = [];

  for (const c of candidatesFor(img)) {
    let res: Response;
    try {
      res = await deps.fetch(c.url);
    } catch (e) {
      reasons.push(`${c.url} 请求异常`);
      continue;
    }
    if (!res.ok) {
      reasons.push(`${c.url} HTTP ${res.status}`);
      continue;
    }

    const contentType = res.headers.get('content-type') ?? '';
    const ext = extensionFor(contentType);
    if (!ext) {
      reasons.push(`${c.url} 非图片类型 ${contentType}`);
      continue;
    }

    // HEIC 无法解码，且下游兼容性差。原图凭 file_id 随时可重取，故直接降级。
    if (c.kind === 'original' && !isDecodable(contentType)) {
      reasons.push(`${c.url} 为 ${contentType}，无法解码`);
      continue;
    }

    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const blob = new Blob([bytes], { type: contentType });

    let dim = { width: img.declaredWidth, height: img.declaredHeight };
    if (isDecodable(contentType)) {
      try {
        dim = await deps.decode(blob);
      } catch {
        reasons.push(`${c.url} 解码失败`);
        continue;
      }
      // 只有原图需要与声明尺寸一致；降级图本就是 1080 宽的派生图。
      if (c.kind === 'original' && (dim.width !== img.declaredWidth || dim.height !== img.declaredHeight)) {
        reasons.push(`${c.url} 尺寸 ${dim.width}x${dim.height} 与声明不符`);
        continue;
      }
    }

    return {
      bytes,
      ext,
      sourceKind: c.kind,
      sourceUrl: c.url,
      width: dim.width,
      height: dim.height,
      sha256: await deps.sha256(buf),
    };
  }

  throw new Error(`第 ${img.index} 张图片全部候选均失败：${reasons.join('；')}`);
}
