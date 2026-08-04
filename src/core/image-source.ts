import type { ExtractedCommentImage, ExtractedImage, SourceKind } from '../types';

export interface Candidate {
  kind: SourceKind;
  url: string;
}

/** 实测两者返回字节数完全一致，互为镜像。 */
const ORIGINAL_HOSTS = ['https://sns-img-qc.xhscdn.com/', 'https://ci.xiaohongshu.com/'];

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/** Chrome 的 createImageBitmap 无法解码这些类型，故不能用尺寸校验。 */
const UNDECODABLE = new Set(['heic', 'heif', 'avif']);

function mimeOf(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}

export function extensionFor(contentType: string): string | null {
  return EXT_BY_TYPE[mimeOf(contentType)] ?? null;
}

export function isDecodable(contentType: string): boolean {
  const ext = extensionFor(contentType);
  return ext !== null && !UNDECODABLE.has(ext);
}

/** 按优先级排列的下载候选。原图不需要任何 token。 */
export function candidatesFor(img: ExtractedImage): Candidate[] {
  const out: Candidate[] = [];
  if (img.fileId) {
    for (const host of ORIGINAL_HOSTS) out.push({ kind: 'original', url: host + img.fileId });
  }
  if (img.urlDefault) out.push({ kind: 'WB_DFT', url: img.urlDefault });
  if (img.urlPre) out.push({ kind: 'WB_PRV', url: img.urlPre });
  return out;
}

/**
 * 评论图只有派生图可取：它没有 fileId，实测按笔记原图的规则构造出的
 * 地址（sns-img-qc / ci.xiaohongshu）一律 404，试它只是白费一次请求。
 */
export function candidatesForComment(img: ExtractedCommentImage): Candidate[] {
  const out: Candidate[] = [];
  if (img.urlDefault) out.push({ kind: 'WB_DFT', url: img.urlDefault });
  if (img.urlPre) out.push({ kind: 'WB_PRV', url: img.urlPre });
  return out;
}
