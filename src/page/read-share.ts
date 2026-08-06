/** 每次读取都回传的现场快照，用于排查。 */
export interface ShareDiag {
  /** 有没有找到 .buttons.engage-bar-style .share-wrapper svg */
  elementFound: boolean;
  /** 进来时面板是不是使用者自己已经点开的 */
  alreadyOpen: boolean;
  /** 面板有没有出现 */
  panelFound: boolean;
  /** 真正接住文案的通道 */
  via: 'writeText' | 'execCommand' | null;
  /** 实际等了多少毫秒 */
  waitedMs: number;
  error?: string;
}

export type ShareReadFailure =
  /** 页面上找不到分享按钮——多半是小红书改版，选择器失效 */
  | 'no_element'
  /** 点了但面板没出来 */
  | 'no_panel'
  /** 面板出来了但没有「复制链接」这一条 */
  | 'no_item'
  /** 点了复制但没人写剪贴板 */
  | 'timeout'
  /** 页面内抛异常 */
  | 'page_error'
  /** 注入本身没跑成 */
  | 'inject_failed';

export type ShareReadResult =
  | { ok: true; text: string; diag: ShareDiag }
  | { ok: false; reason: ShareReadFailure; detail?: string; diag: ShareDiag };

/**
 * 注入到页面 MAIN world 执行：让页面自己走完「分享 → 复制链接」，把它要写进
 * 剪贴板的文案接住，再把面板收回去。**只回传原文，不做解析**——文案到链接的
 * 映射在 core/share.ts，那边能在 Node 下测。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**，
 * 常量、辅助函数都得写在函数体里。
 *
 * 五条实测约束：
 * 1. 分享按钮是 `.buttons.engage-bar-style .share-wrapper svg`。只写
 *    `.engage-bar .share-wrapper` 会命中 modal 背后信息流卡片上的分享图标——
 *    页面上存在两套 engage-bar。
 * 2. **只能对 svg 一层派发 click。** 对 wrapper / container / svg 三层都派发会
 *    连续 toggle 三次，净结果是面板关着，现象看起来像「合成事件无效」。
 * 3. 不需要 hover 祖先链——这点与作者卡片不同，那边必须逐层派发 enter。
 * 4. 点完「复制链接」面板不会自动关，必须再点一次 svg。
 * 5. 剪贴板要拦截而不真写：使用者的剪贴板不该因为一次采集被覆盖。
 */
export async function readShareLinkFromPage(): Promise<ShareReadResult> {
  const diag: ShareDiag = {
    elementFound: false,
    alreadyOpen: false,
    panelFound: false,
    via: null,
    waitedMs: 0,
  };

  // 还原用的现场，必须在 try 外面声明——catch 里也要能收拾干净。
  let restoreClipboard: (() => void) | null = null;
  let origExec: typeof document.execCommand | null = null;
  // 是否真的动过 document.execCommand——没走到那一步就不该在 finally 里瞎删。
  let execOverridden = false;

  // 页面自己的 click 监听器抛出的异常，DOM 规范规定不会沿着 dispatchEvent
  // 同步冒泡回调用方（"report the exception"，不 rethrow）——所以 try/catch
  // 包住 dispatchEvent 是抓不到的，必须另开一个 window error 监听器接住，
  // 并 preventDefault 掉，不然会在控制台留下一条跟使用者无关的「未捕获异常」。
  let windowErrorMsg: string | null = null;
  const onWindowError = (ev: ErrorEvent) => {
    windowErrorMsg = ev.error instanceof Error ? `${ev.error.name}: ${ev.error.message}` : String(ev.message);
    ev.preventDefault();
  };
  window.addEventListener('error', onWindowError);

  try {
    const TIMEOUT_MS = 3000;
    const POLL_MS = 100;
    const ITEM = '.xhs-note-share-popup-action-item';

    const svg = document.querySelector('.buttons.engage-bar-style .share-wrapper svg');
    diag.elementFound = svg !== null;
    if (!svg) return { ok: false, reason: 'no_element', diag };

    // jsdom 里 PointerEvent 支持不完整，真实页面上偶尔也会缺；降级到 MouseEvent
    // 不影响触发——这个组件只看 click。
    const PE: typeof MouseEvent =
      typeof PointerEvent !== 'undefined' ? (PointerEvent as unknown as typeof MouseEvent) : MouseEvent;

    /** 对**单个**元素派发一整套按下-抬起-点击。绝不对祖先链重复派发，见约束 2。 */
    const click = (el: Element) => {
      const r = el.getBoundingClientRect();
      const o: MouseEventInit = {
        clientX: Math.round(r.left + r.width / 2),
        clientY: Math.round(r.top + r.height / 2),
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(new PE('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      el.dispatchEvent(new PE('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent('click', o));
    };

    const items = (): Element[] => Array.from(document.querySelectorAll(ITEM));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const started = Date.now();

    // 使用者自己点开的面板不属于我们，记下来，结束时原样留着。
    diag.alreadyOpen = items().length > 0;
    if (!diag.alreadyOpen) {
      click(svg);
      if (windowErrorMsg) return { ok: false, reason: 'page_error', detail: windowErrorMsg, diag: { ...diag, error: windowErrorMsg } };
      while (Date.now() - started < TIMEOUT_MS && items().length === 0 && !windowErrorMsg) await sleep(POLL_MS);
      if (windowErrorMsg) return { ok: false, reason: 'page_error', detail: windowErrorMsg, diag: { ...diag, error: windowErrorMsg } };
    }

    /** 我们开的就要我们关；本来就开着的不动。失败路径也要走一遍。 */
    const restorePanel = () => {
      if (!diag.alreadyOpen && items().length > 0) {
        try { click(svg); } catch (e) { /* 收不起来也不该丢掉已经拿到的数据 */ }
      }
    };

    diag.panelFound = items().length > 0;
    if (!diag.panelFound) {
      diag.waitedMs = Date.now() - started;
      return { ok: false, reason: 'no_panel', diag };
    }

    const copyItem = items().find((el) => (el.textContent ?? '').indexOf('复制链接') >= 0);
    if (!copyItem) {
      diag.waitedMs = Date.now() - started;
      restorePanel();
      return { ok: false, reason: 'no_item', diag };
    }

    let captured: { via: 'writeText' | 'execCommand'; text: string } | null = null;

    // 拦截而不写入。用前存下描述符：直接 delete 会在页面本来就有同名自有属性时
    // 把它永久抹掉。navigator.clipboard 在非安全上下文下可能压根不存在。
    const clip = navigator.clipboard as { writeText?: (t: string) => Promise<void> } | undefined;
    if (clip && typeof clip.writeText === 'function') {
      const desc = Object.getOwnPropertyDescriptor(clip, 'writeText');
      Object.defineProperty(clip, 'writeText', {
        configurable: true,
        writable: true,
        value: (t: string) => {
          if (!captured) captured = { via: 'writeText', text: String(t) };
          return Promise.resolve();
        },
      });
      restoreClipboard = () => {
        if (desc) Object.defineProperty(clip, 'writeText', desc);
        else delete (clip as Record<string, unknown>).writeText;
      };
    }

    // execCommand 兜底：老实现走的是选中 textarea 再 copy 这条路。
    // 测试环境（jsdom）压根不实现这个 API，document.execCommand 本身就是
    // undefined，不能假定它可 bind；真实 Chrome 里则一定存在。
    const hadExecCommand = typeof document.execCommand === 'function';
    origExec = hadExecCommand ? document.execCommand.bind(document) : null;
    document.execCommand = function (cmd: string, ...rest: unknown[]) {
      if (String(cmd).toLowerCase() === 'copy') {
        const a = document.activeElement as { value?: string; textContent?: string | null } | null;
        const t = a && a.value !== undefined ? a.value : a?.textContent ?? '';
        if (!captured && t) captured = { via: 'execCommand', text: String(t) };
        return true;
      }
      return origExec ? (origExec as (c: string, ...r: unknown[]) => boolean)(cmd, ...rest) : false;
    } as typeof document.execCommand;
    execOverridden = true;

    click(copyItem);
    if (windowErrorMsg) {
      restorePanel();
      return { ok: false, reason: 'page_error', detail: windowErrorMsg, diag: { ...diag, error: windowErrorMsg } };
    }
    while (Date.now() - started < TIMEOUT_MS && !captured && !windowErrorMsg) await sleep(POLL_MS);
    diag.waitedMs = Date.now() - started;

    restorePanel();

    if (windowErrorMsg) return { ok: false, reason: 'page_error', detail: windowErrorMsg, diag: { ...diag, error: windowErrorMsg } };
    if (!captured) return { ok: false, reason: 'timeout', diag };
    const hit = captured as { via: 'writeText' | 'execCommand'; text: string };
    diag.via = hit.via;
    return { ok: true, text: hit.text, diag };
  } catch (e) {
    diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason: 'page_error', detail: diag.error, diag };
  } finally {
    // 无论走哪条路都必须把页面还回去，否则使用者的剪贴板从此归我们管。
    window.removeEventListener('error', onWindowError);
    try { restoreClipboard?.(); } catch (e) { /* 还原失败不该盖掉真正的失败原因 */ }
    if (execOverridden) {
      if (origExec) {
        document.execCommand = origExec;
      } else {
        // 原本就没有这个属性（jsdom 测试环境），删掉我们加的，别留下痕迹。
        try { delete (document as unknown as Record<string, unknown>).execCommand; } catch (e) { /* 忽略 */ }
      }
    }
  }
}

const EMPTY_DIAG: ShareDiag = {
  elementFound: false,
  alreadyOpen: false,
  panelFound: false,
  via: null,
  waitedMs: 0,
};

/**
 * 注入失败与「页面上没有分享按钮」必须分开报：前者是扩展侧问题（权限、world、
 * 时序），后者是页面侧问题（改版、还没渲染）。
 *
 * 不接收 expectedNoteId——身份校验在 core/share.ts 那一层做。
 */
export async function readShareViaTab(tabId: number): Promise<ShareReadResult> {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readShareLinkFromPage,
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'inject_failed',
      detail: e instanceof Error ? e.message : String(e),
      diag: { ...EMPTY_DIAG },
    };
  }

  const result = res?.result as ShareReadResult | undefined;
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
