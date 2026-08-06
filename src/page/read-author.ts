import type { RawAuthorCard } from '../types';

/** 每次读取都回传的现场快照，用于排查。 */
export interface AuthorDiag {
  /** 有没有找到 .author-container span.username */
  elementFound: boolean;
  /** hook = 抓到页面自己发的响应；dom = 走文本兜底；null = 都没有 */
  via: 'hook' | 'dom' | null;
  /** 实际等了多少毫秒 */
  waitedMs: number;
  /** 从请求 URL 取到的 target_user_id */
  uid: string | null;
  error?: string;
}

export type AuthorReadFailure =
  /** 页面上找不到作者元素——多半是小红书改版，选择器失效 */
  | 'no_element'
  /** 既没抓到响应，卡片也没弹出来 */
  | 'timeout'
  /** 拿到的卡片不属于当前笔记作者（页面中途切了笔记） */
  | 'uid_mismatch'
  /** 页面内抛异常 */
  | 'page_error'
  /** 注入本身没跑成 */
  | 'inject_failed';

export type AuthorReadResult =
  | { ok: true; raw: RawAuthorCard; diag: AuthorDiag }
  | { ok: false; reason: AuthorReadFailure; detail?: string; diag: AuthorDiag };

/**
 * 注入到页面 MAIN world 执行：让页面自己去请求作者卡片，把响应接住，再把卡片收起。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**，
 * 常量、正则、辅助函数都得写在函数体里。
 *
 * 四条实测约束：
 * 1. 触发元素是 .author-container span.username。页面底部另有 .author-wrapper >
 *    a.author，那不是它，对着它派发事件毫无反应。
 * 2. 必须对 document 到目标元素的**整条祖先链**逐层派发不冒泡的 pointerenter /
 *    mouseenter。只派发目标元素及其两三层父节点，卡片不弹、请求也不发。
 * 3. 收起卡片时 leave 系列必须带 relatedTarget，并对那个元素再派发一整套 enter，
 *    否则组件认为指针还停在原处，卡片一直挂在使用者眼前。
 * 4. 页面对 hover_card 有客户端缓存，同一作者第二次 hover 不再发请求。所以钩子
 *    等不到时要从 DOM 兜底，否则「自己先看过一眼的作者反而采不到」。
 */
export async function readAuthorCardFromPage(expectedUserId: string): Promise<AuthorReadResult> {
  const diag: AuthorDiag = { elementFound: false, via: null, waitedMs: 0, uid: null };

  try {
    const TIMEOUT_MS = 3000;
    const POLL_MS = 100;

    const target = document.querySelector('.author-container span.username');
    diag.elementFound = target !== null;
    if (!target) return { ok: false, reason: 'no_element', diag };

    // jsdom 里 PointerEvent 支持不完整，真实页面上偶尔也会缺；降级到 MouseEvent
    // 不影响触发，enter 链才是关键。
    const PE: typeof MouseEvent =
      typeof PointerEvent !== 'undefined' ? (PointerEvent as unknown as typeof MouseEvent) : MouseEvent;

    let captured: { uid: string | null; data: RawAuthorCard } | null = null;

    const grab = (url: string, text: string) => {
      if (url.indexOf('hover_card') < 0) return;
      try {
        const body = JSON.parse(text) as { data?: RawAuthorCard };
        if (!body || !body.data) return;
        const m = /target_user_id=([0-9a-zA-Z]+)/.exec(url);
        captured = { uid: m ? m[1]! : null, data: body.data };
      } catch (e) { /* 不是我们要的响应，忽略 */ }
    };

    // 钩住 XHR 与 fetch。实测 hover_card 走 XHR，但两个都钩更保险。
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR(this: unknown) {
      const x = new OrigXHR();
      const open = x.open as (...a: unknown[]) => void;
      let seen = '';
      x.open = function (method: string, url: string, ...rest: unknown[]) {
        seen = url;
        open.call(x, method, url, ...rest);
      } as typeof x.open;
      x.addEventListener('load', () => { grab(seen, x.responseText); });
      return x;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
        const p = origFetch.apply(this, args);
        try {
          const first = args[0];
          const url = typeof first === 'string' ? first : (first as Request | URL).toString();
          if (url.indexOf('hover_card') >= 0) {
            void p.then((r) => r.clone().text()).then((t) => { grab(url, t); }).catch(() => {});
          }
        } catch (e) { /* 取 url 失败不该拖累原请求 */ }
        return p;
      } as typeof fetch;
    }

    const chainOf = (el: Element | null): (Element | Document)[] => {
      const out: (Element | Document)[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) out.unshift(n);
      out.unshift(document);
      return out;
    };

    const enter = (el: Element, related: Element | null) => {
      // 不带 view：jsdom 里 `window instanceof Window` 为假，带上会直接抛
      // TypeError；真实页面上的悬浮卡片组件也不读这个字段，只看坐标与 relatedTarget。
      const r = el.getBoundingClientRect();
      const o: MouseEventInit = {
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        bubbles: true,
        cancelable: true,
        relatedTarget: related,
      };
      el.dispatchEvent(new PE('pointerover', o));
      for (const n of chainOf(el)) n.dispatchEvent(new PE('pointerenter', { ...o, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseover', o));
      for (const n of chainOf(el)) n.dispatchEvent(new MouseEvent('mouseenter', { ...o, bubbles: false }));
      el.dispatchEvent(new PE('pointermove', o));
      el.dispatchEvent(new MouseEvent('mousemove', o));
    };

    const leave = (el: Element, to: Element) => {
      const o: MouseEventInit = {
        clientX: 0, clientY: 0, bubbles: true, cancelable: true, relatedTarget: to,
      };
      el.dispatchEvent(new PE('pointerout', o));
      for (const n of chainOf(el).reverse()) n.dispatchEvent(new PE('pointerleave', { ...o, bubbles: false }));
      el.dispatchEvent(new MouseEvent('mouseout', o));
      for (const n of chainOf(el).reverse()) n.dispatchEvent(new MouseEvent('mouseleave', { ...o, bubbles: false }));
      // 再让「指针」进入别处，否则组件认为它还停在作者名上，卡片收不回去。
      enter(to, el);
    };

    /** 卡片已渲染时从文本兜底。读不到认证类型，那个字段就该缺席。 */
    const fromDom = (): RawAuthorCard | null => {
      const card = document.querySelector('.tooltip-content');
      if (!card) return null;
      const counts: Record<string, string> = {};
      for (const a of Array.from(card.querySelectorAll('.interaction-info a.interaction'))) {
        const nameEl = a.querySelector('.interaction-name');
        const label = (nameEl?.textContent ?? '').trim();
        const value = ((a as HTMLElement).textContent ?? '').replace(label, '').trim();
        if (label === '关注') counts.follows = value;
        else if (label === '粉丝') counts.fans = value;
        else if (label === '获赞与收藏') counts.interaction = value;
      }
      if (counts.follows === undefined && counts.fans === undefined && counts.interaction === undefined) {
        return null;
      }
      return {
        basic_info: {
          nickname: (card.querySelector('.basic-info .name')?.textContent ?? '').trim(),
          desc: (card.querySelector('.desc')?.textContent ?? '').trim(),
        },
        interact_info: { follows: counts.follows, fans: counts.fans, interaction: counts.interaction },
      };
    };

    const started = Date.now();
    enter(target, null);

    let domCard: RawAuthorCard | null = null;
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (captured) break;
      domCard = fromDom();
      if (domCard) break;
    }
    diag.waitedMs = Date.now() - started;

    // 无论成败都要收起来：卡片留在页面上会挡住使用者正在看的内容。
    try {
      leave(target, document.body);
    } catch (e) { /* 收不起来也不该把已经拿到的数据丢掉 */ }

    window.XMLHttpRequest = OrigXHR;
    if (typeof origFetch === 'function') window.fetch = origFetch;

    if (captured) {
      const hit = captured as { uid: string | null; data: RawAuthorCard };
      diag.via = 'hook';
      diag.uid = hit.uid;
      // 页面中途切了笔记时，抓到的会是上一个作者。写进去就是张冠李戴。
      if (hit.uid !== null && hit.uid !== expectedUserId) {
        return { ok: false, reason: 'uid_mismatch', detail: `卡片属于 ${hit.uid}`, diag };
      }
      return { ok: true, raw: hit.data, diag };
    }

    if (domCard) {
      diag.via = 'dom';
      // DOM 上没有 userId，无从校验身份。卡片是我们刚让它为当前作者弹出来的，
      // 且这条路径只在同一次调用内成立，风险可接受。
      return { ok: true, raw: domCard, diag };
    }

    return { ok: false, reason: 'timeout', diag };
  } catch (e) {
    diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason: 'page_error', detail: diag.error, diag };
  }
}

const EMPTY_DIAG: AuthorDiag = { elementFound: false, via: null, waitedMs: 0, uid: null };

/**
 * 注入失败与「页面上没有作者元素」必须分开报：前者是扩展侧问题（权限、world、
 * 时序），后者是页面侧问题（改版、还没渲染）。
 */
export async function readAuthorViaTab(tabId: number, expectedUserId: string): Promise<AuthorReadResult> {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readAuthorCardFromPage,
      args: [expectedUserId],
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'inject_failed',
      detail: e instanceof Error ? e.message : String(e),
      diag: { ...EMPTY_DIAG },
    };
  }

  const result = res?.result as AuthorReadResult | undefined;
  if (!result) {
    // Chrome 把页面内抛出的异常放在 error 字段里，没有它就只剩「无返回值」。
    const injectionError = (res as { error?: { message?: string } } | undefined)?.error?.message;
    return {
      ok: false,
      reason: 'inject_failed',
      detail: injectionError ?? (res ? '注入脚本无返回值' : '注入未命中任何 frame'),
      diag: { ...EMPTY_DIAG },
    };
  }
  return result;
}
