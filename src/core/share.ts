export type ShareUrlFailure =
  /** 文案里根本没有链接——多半是平台改了口令模板 */
  | 'no_url'
  /** 链接指向别的笔记——页面中途切了笔记 */
  | 'id_mismatch';

export type ShareUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: ShareUrlFailure };

/**
 * 链接的结束边界。字符类同时承担两件事：在空白处截断，以及剥掉紧贴在
 * 链接尾部的中文标点与引号。所以匹配完不需要再 trim 一次。
 */
const LINK_RE = /https?:\/\/[^\s，。！？、）】」"'<>]+/;

/**
 * 从「复制链接」写进剪贴板的口令文案里取出笔记地址。
 *
 * 实测文案形态：`61 【标题 - 作者 | 小红书…】 😆 https://…/discovery/item/{id}?…`
 * 开头的数字是分享码，我们不要。
 *
 * 返回判别联合而不是 `string | null`：no_url 说明模板变了，id_mismatch 说明
 * 页面中途切了笔记，两者要查的地方完全不同，兜成同一个 null 就把区别丢了。
 */
export function extractShareUrl(text: string, expectedNoteId: string): ShareUrlResult {
  const m = LINK_RE.exec(text);
  if (!m) return { ok: false, reason: 'no_url' };

  const url = m[0];
  // 不校验就可能把上一篇的链接写进这一篇的 note.json。宁可不写，不可写错。
  if (!url.includes(expectedNoteId)) return { ok: false, reason: 'id_mismatch' };

  return { ok: true, url };
}
