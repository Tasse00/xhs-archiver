// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readAuthorCardFromPage } from '../../src/page/read-author';

/** 搭出实测的作者栏 DOM。 */
function mountAuthor(): void {
  document.body.innerHTML = `
    <div class="note-container">
      <div class="author-container"><a class="name"><span class="username">小红</span></a></div>
    </div>`;
}

/** 搭出实测的卡片 DOM。 */
function mountCard(nickname: string, desc: string, counts: [string, string, string]): void {
  const card = document.createElement('div');
  card.className = 'tooltip-content';
  card.innerHTML = `
    <div class="basic-info"><div class="avatar-click-wrapper"><a class="avatar-info"><div class="name">${nickname}</div></a></div></div>
    <div class="desc">${desc}</div>
    <div class="interaction-info">
      <a class="interaction">${counts[0]}<span class="interaction-name">关注</span></a>
      <a class="interaction">${counts[1]}<span class="interaction-name">粉丝</span></a>
      <a class="interaction">${counts[2]}<span class="interaction-name">获赞与收藏</span></a>
    </div>`;
  document.body.appendChild(card);
}

/**
 * 装一个假的 XHR：一旦目标元素收到 mouseenter，就在下一个 tick 回一份 hover_card 响应。
 * 真实页面就是这么工作的——脚本不发请求，只是让页面自己去发。
 */
function fakeXhrOnHover(uid: string, body: unknown): void {
  class FakeXHR {
    private handlers: Record<string, (() => void)[]> = {};
    responseText = '';
    __u = '';
    open(_m: string, u: string) { this.__u = u; }
    send() {
      this.responseText = JSON.stringify(body);
      setTimeout(() => { for (const h of this.handlers.load ?? []) h(); }, 0);
    }
    addEventListener(t: string, h: () => void) { (this.handlers[t] ??= []).push(h); }
  }
  (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR;

  const un = document.querySelector('.author-container span.username')!;
  un.addEventListener('mouseenter', () => {
    const x = new (globalThis as unknown as { XMLHttpRequest: new () => { open(m: string, u: string): void; send(): void } }).XMLHttpRequest();
    x.open('GET', `https://edith.xiaohongshu.com/api/sns/web/v1/user/hover_card?target_user_id=${uid}&xsec_source=pc_note`);
    x.send();
  });
}

const CARD_BODY = {
  code: 0,
  success: true,
  data: {
    basic_info: { nickname: '小红', images: 'https://a/x', desc: '简介' },
    verify_info: { red_official_verify_type: 0 },
    interact_info: { follows: '21', fans: '384', interaction: '1500' },
  },
};

describe('readAuthorCardFromPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('找不到作者元素时报 no_element', async () => {
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_element');
    expect(r.diag.elementFound).toBe(false);
  });

  it('对整条祖先链派发 enter，而不只是目标元素', async () => {
    mountAuthor();
    const seen: string[] = [];
    for (const el of [document.body, document.querySelector('.note-container')!, document.querySelector('.author-container')!]) {
      el.addEventListener('mouseenter', () => seen.push((el as HTMLElement).className || 'body'));
    }
    await readAuthorCardFromPage('u1');
    expect(seen).toContain('author-container');
    expect(seen).toContain('note-container');
    expect(seen).toContain('body');
  });

  it('抓到页面自己发的响应', async () => {
    mountAuthor();
    fakeXhrOnHover('u1', CARD_BODY);
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw.interact_info).toEqual({ follows: '21', fans: '384', interaction: '1500' });
    expect(r.diag.via).toBe('hook');
    expect(r.diag.uid).toBe('u1');
  });

  // 页面中途切了笔记，卡片属于上一个作者。写进去会张冠李戴。
  it('uid 与预期不符时整个丢弃', async () => {
    mountAuthor();
    fakeXhrOnHover('other', CARD_BODY);
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('uid_mismatch');
  });

  // 页面对 hover_card 有客户端缓存，使用者自己先看过一眼，钩子就什么都抓不到。
  it('没有网络响应但卡片已弹出时从 DOM 兜底', async () => {
    mountAuthor();
    const un = document.querySelector('.author-container span.username')!;
    un.addEventListener('mouseenter', () => mountCard('小红', '简介', ['21', '384', '1500']));
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.raw.interact_info).toEqual({ follows: '21', fans: '384', interaction: '1500' });
      expect(r.raw.basic_info?.desc).toBe('简介');
      // DOM 上读不到认证类型，这个字段必须缺席
      expect(r.raw.verify_info).toBeUndefined();
    }
    expect(r.diag.via).toBe('dom');
  });

  it('既没响应也没卡片时报 timeout', async () => {
    mountAuthor();
    const r = await readAuthorCardFromPage('u1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });

  // 卡片留在页面上会挡住使用者正在看的内容。
  it('无论成败都派发带 relatedTarget 的 leave 收起卡片', async () => {
    mountAuthor();
    const un = document.querySelector('.author-container span.username')!;
    let leaveRelated: EventTarget | null | undefined;
    un.addEventListener('mouseleave', (e) => { leaveRelated = (e as MouseEvent).relatedTarget; });
    await readAuthorCardFromPage('u1');
    expect(leaveRelated).toBe(document.body);
  });
});
