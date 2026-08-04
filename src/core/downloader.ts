import type { ExtractedCommentImage, ExtractedImage, SourceKind } from '../types';
import { type Candidate, candidatesFor, candidatesForComment, extensionFor, isDecodable } from './image-source';

export interface Deps {
  fetch: typeof fetch;
  decode(b: Blob): Promise<{ width: number; height: number }>;
  sha256(b: ArrayBuffer): Promise<string>;
}

export interface FetchedImage {
  /** 显式绑定 ArrayBuffer：不写的话默认是 ArrayBufferLike，落盘时不认 BlobPart。 */
  bytes: Uint8Array<ArrayBuffer>;
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

interface FetchPlan {
  candidates: Candidate[];
  /** 解码失败时的兜底尺寸。 */
  fallbackWidth: number;
  fallbackHeight: number;
  /** 声明尺寸可信时才校验；评论图的声明尺寸是展示尺寸，不可信。 */
  expectedDims: { width: number; height: number } | null;
  /** 全部候选失败时的错误抬头。 */
  label: string;
}

/**
 * 按候选顺序尝试，返回第一个可用的。
 * 原图必须通过尺寸校验；HEIC 无法在 Chrome 中解码，直接跳过改用降级图。
 */
export async function downloadImage(img: ExtractedImage, deps: Deps): Promise<FetchedImage> {
  return fetchFirstUsable(deps, {
    candidates: candidatesFor(img),
    fallbackWidth: img.declaredWidth,
    fallbackHeight: img.declaredHeight,
    expectedDims: { width: img.declaredWidth, height: img.declaredHeight },
    label: `第 ${img.index} 张图片`,
  });
}

/**
 * 评论图。与笔记图的两点不同都是实测出来的：
 * - 没有 fileId，构造出的原图地址一律 404，只有 WB_DFT / WB_PRV 可用；
 * - 声明尺寸是展示尺寸（284x367 的图实际 556x717），拿来校验会全数失败。
 */
export async function downloadCommentImage(
  img: ExtractedCommentImage,
  deps: Deps,
): Promise<FetchedImage> {
  return fetchFirstUsable(deps, {
    candidates: candidatesForComment(img),
    fallbackWidth: img.declaredWidth,
    fallbackHeight: img.declaredHeight,
    expectedDims: null,
    label: `评论图 ${img.index}`,
  });
}

async function fetchFirstUsable(deps: Deps, plan: FetchPlan): Promise<FetchedImage> {
  const reasons: string[] = [];

  for (const c of plan.candidates) {
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

    let dim = { width: plan.fallbackWidth, height: plan.fallbackHeight };
    if (isDecodable(contentType)) {
      try {
        dim = await deps.decode(blob);
      } catch {
        reasons.push(`${c.url} 解码失败`);
        continue;
      }
      // 只有原图需要与声明尺寸一致；降级图本就是 1080 宽的派生图。
      const want = plan.expectedDims;
      if (c.kind === 'original' && want && (dim.width !== want.width || dim.height !== want.height)) {
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

  throw new Error(`${plan.label}全部候选均失败：${reasons.join('；')}`);
}
