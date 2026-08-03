import type { ExtractedImage, SourceKind } from '../types';

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
