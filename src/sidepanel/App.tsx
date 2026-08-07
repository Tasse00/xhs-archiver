import { useCallback, useEffect, useRef, useState } from 'react';
import { createStore, type Store } from '../core/store';
import {
  loadRootHandle, saveRootHandle, ensurePermission, hasPermission, isPermissionError,
  isMissingError, rootExists,
} from '../core/handle-store';
import { chromeLocalArea, loadSettings, saveSettings, defaultDatasetPath, isValidDatasetPath } from '../core/settings';
import { ensureRepoTemplates } from '../core/repo-template';
import { archive } from '../core/archiver';
import { deleteNote, planDelete, type DeletePlan, type DeleteResult } from '../core/delete';
import { readNoteViaTab, type PageDiag } from '../page/read-note';
import { readAuthorViaTab } from '../page/read-author';
import { readShareViaTab } from '../page/read-share';
import { extractAuthorCard } from '../core/author';
import { extractShareUrl } from '../core/share';
import { nowBeijingIso } from '../core/time';
import type { ExtractedComments, ExtractedNote, Pointer } from '../types';
import { isTransient, resolvePanelState, type PanelState } from './usePanelState';
import { buildLogEntry, recordLog, shouldLog, type LogEntry } from './log';
import {
  RootSetup, PermissionSetup, MissingRootSetup, CollectorSetup, PathSetup, CaptureSetup,
} from './components/Setup';
import { NoteView, type ArchiveOutcome, type AuthorOutcome, type ShareOutcome } from './components/NoteView';
import { LogView } from './components/LogView';
import { IconRefresh, IconBrowse, IconGear } from './components/Icons';
import { openBrowser } from './open-browser';
import type { ArchiveMode } from './components/Actions';

/** 重读的间隔，递增。用尽了才认定是真失败。 */
const RETRY_DELAYS = [300, 700, 1500];

/**
 * 记一次判定结果。不在笔记页上的不记（见 shouldLog），结论与上一条相同的
 * 就地合并（见 recordLog）。只在一次判定尘埃落定时调用——重试中的中间态
 * 不单独成条，重读了几次记在 attempts 里。
 */
function pushLog(
  setLog: (fn: (prev: LogEntry[]) => LogEntry[]) => void,
  state: PanelState,
  tabUrl: string,
  diag: PageDiag | null,
  attempts = 0,
) {
  if (!shouldLog(state)) return;
  setLog((prev) => recordLog(prev, buildLogEntry(state, tabUrl, diag, new Date(), attempts)));
}

/** 这次采集要写什么、覆盖谁。三种可采状态的差别全在这里。 */
interface ArchivePlan {
  note: ExtractedNote;
  comments: ExtractedComments;
  existing?: Pointer;
  /** 接管时要作废的旧指针。 */
  supersede?: Pointer[];
}

function planOf(state: PanelState): ArchivePlan | null {
  switch (state.kind) {
    case 'ready':
      return { note: state.note, comments: state.comments };
    case 'mine':
      return { note: state.note, comments: state.comments, existing: state.pointer };
    // 接管：拿第一条指针定原位置，但作废全部——多条指针是并发采集竞态，
    // 只处理第一条会留下指向同一篇的孤儿指针。
    case 'others':
      return {
        note: state.note,
        comments: state.comments,
        existing: state.pointers[0],
        supersede: state.pointers,
      };
    default:
      return null;
  }
}

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  // 句柄要留着，不能只留 store：权限被回收后靠它一次点击就能恢复，
  // 丢了就只剩「重新选目录」这一条路。
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootName, setRootName] = useState<string | null>(null);
  const [collector, setCollector] = useState<string | null>(null);
  const [datasetPath, setDatasetPath] = useState(defaultDatasetPath());
  // 有默认值不等于使用者确认过。没确认就先把路径摆出来问一次，见 need_path。
  const [pathConfirmed, setPathConfirmed] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: 'need_root' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // 「刚刚采完」与「以前采过」在 mine 状态下长得一样，必须显式区分，
  // 否则用户点完按钮看到的是一段历史记录，无法确认本次是否成功。
  const [justArchived, setJustArchived] = useState<ArchiveOutcome | null>(null);
  // 两步页面交互（作者卡片、分享面板）串行执行，界面要能分别说清在做哪一步。
  const [pageStep, setPageStep] = useState<'author' | 'share' | null>(null);
  // 删除确认块的内容。null 表示没打开——打开时才去读盘算计划。
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null);
  const [justDeleted, setJustDeleted] = useState<DeleteResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  // 顶栏点「采集者」进来的改设置界面。null 表示没在改。
  const [editingCollector, setEditingCollector] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [editingCapture, setEditingCapture] = useState(false);
  // 两个采集开关。默认打开，与 loadSettings 的缺省一致。
  const [captureAuthor, setCaptureAuthor] = useState(true);
  const [captureShare, setCaptureShare] = useState(true);
  // 判定周期序号，用来作废被新触发取代的旧周期。见 refresh。
  const genRef = useRef(0);

  const attachRoot = useCallback(async (handle: FileSystemDirectoryHandle) => {
    if (!(await ensurePermission(handle))) {
      setMessage('目录授权未通过，请重新选择。');
      return;
    }
    const s = createStore(handle);
    // store 必须无条件挂上，哪怕目录不在了：refresh 里「有权限」与「有 store」
    // 是同一件事，只在成功建模板时才 setStore 会让目录消失被误报成授权失效。
    setStore(s);
    setRoot(handle);
    setRootName(handle.name);
    // 目录已经不在磁盘上时写模板会抛 NotFoundError。之前它逸出成未捕获的
    // rejection，store 永远设不上，界面就一直停在「授权失效」——方向完全错了。
    // 这里静默返回即可，refresh 那一轮会把 missing_root 摆到界面上。
    if (!(await rootExists(handle))) return;
    const created = await ensureRepoTemplates(s);
    if (created.length > 0) setMessage(`已初始化仓库模板：${created.join('、')}`);
  }, []);

  // 恢复已保存的目录句柄与设置
  useEffect(() => {
    void (async () => {
      const st = await loadSettings(chromeLocalArea);
      setCollector(st.collector);
      setCaptureAuthor(st.captureAuthor);
      setCaptureShare(st.captureShare);
      const handle = await loadRootHandle();
      // 权限不够时也要把句柄收下：这里不能 requestPermission（没有用户手势），
      // 但丢掉它就会退回 need_root，让人以为目录从没选过、得重选一遍。
      if (handle) {
        setRoot(handle);
        setRootName(handle.name);
        if (await hasPermission(handle)) await attachRoot(handle);
      }
      // 存过路径 = 之前确认过，不再拦一次；没存过就保留 collected 默认值。
      if (st.datasetPath !== null) {
        setDatasetPath(st.datasetPath);
        setPathConfirmed(true);
      }
    })();
  }, [attachRoot]);

  const refresh = useCallback(async (attempt = 0, gen?: number) => {
    // 一次判定周期共用一个序号，重试沿用它。周期开始后又来了新的触发，
    // 旧周期的结果就作废——否则几个并发周期会各写各的日志和状态。
    const myGen = gen ?? ++genRef.current;
    // 任何一步抛出都会让面板静默停在旧状态，比报错更难排查，所以整体兜住。
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (myGen !== genRef.current) return;
      // 换了标签页或换了笔记，上一次的采集结果就不再是「本次」的了。
      setJustArchived(null);
      setJustDeleted(null);
      // 换了笔记，上一篇算出来的删除计划就不能再用了
      setDeletePlan(null);
      setMessage(null);

      // 每个周期都查一遍：权限会在两次判定之间被回收（关掉浏览页就会），
      // 只在挂载时查过是不够的。query 不需要用户手势，很便宜。
      const granted = store !== null && root !== null && (await hasPermission(root));
      if (myGen !== genRef.current) return;
      // 目录同样可能在两次判定之间消失（使用者直接把它删了）。没权限时不探，
      // 探测本身会抛 NotAllowedError，那种情况归权限那条路管。
      const exists = granted && root !== null ? await rootExists(root) : true;
      if (myGen !== genRef.current) return;

      let diag: PageDiag | null = null;
      const next = await resolvePanelState({
        hasRoot: root !== null,
        hasPermission: granted,
        rootExists: exists,
        store: store ?? createStore({} as FileSystemDirectoryHandle),
        collector,
        hasDatasetPath: pathConfirmed,
        tabUrl: tab?.url ?? '',
        onDiag: (d) => { diag = d; },
        readNote: async () =>
          tab?.id === undefined
            ? {
                ok: false,
                reason: 'inject_failed',
                detail: '当前窗口没有活动标签页',
                diag: {
                  pathname: '', urlId: null, currentNoteId: null,
                  mapKeys: [], entryFound: false, commentCount: 0,
                },
              }
            : readNoteViaTab(tab.id),
      });
      if (myGen !== genRef.current) return;

      // 页面数据是异步填充的：SPA 一改 URL 就触发重读，而这篇笔记的数据往往
      // 还没填进 store。这时显示错误纯属吓人——它多半几百毫秒后就自己好了。
      // 所以先挂「读取中」，重试用尽了才把真错误摆出来。
      const transient = next.kind === 'unreadable' && isTransient(next.reason);
      if (transient && attempt < RETRY_DELAYS.length) {
        // 重试中的中间态不进日志：它几百毫秒后就会被最终结论取代，
        // 记下来只会让打开一篇笔记刷出四条。重读次数记在最终那条上。
        setState({ kind: 'reading' });
        setTimeout(() => void refreshRef.current?.(attempt + 1, myGen), RETRY_DELAYS[attempt]);
        return;
      }
      setState(next);
      pushLog(setLog, next, tab?.url ?? '', diag, attempt);
    } catch (e) {
      // 权限在这一轮判定的中途被回收（上面查过之后才掉）。这不是故障，
      // 报成 panel_error 会让人对着一句 NotAllowedError 无从下手。
      if (isPermissionError(e)) {
        setState({ kind: 'need_permission' });
        return;
      }
      // 目录在这一轮的中途被删掉。listEntries 之类的遍历不像读文件那样把
      // NotFoundError 吞成「空」，它会一路抛上来，所以这里也要接住。
      if (isMissingError(e)) {
        setState({ kind: 'missing_root' });
        return;
      }
      // 这里兜住的是侧边栏自身的异常，不是注入失败。标成 inject_failed 会把
      // 排查方向指到扩展权限上去，而真正的原因可能在别处。
      const detail = e instanceof Error ? e.message : String(e);
      const failed: PanelState = { kind: 'unreadable', reason: 'panel_error', detail };
      setState(failed);
      pushLog(setLog, failed, '', null);
    }
  }, [store, root, collector, pathConfirmed]);

  // refresh 要在自己内部延时重调自己，用 ref 绕开闭包里的循环依赖。
  const refreshRef = useRef<((attempt?: number, gen?: number) => Promise<void>) | null>(null);
  refreshRef.current = refresh;

  useEffect(() => { void refresh(); }, [refresh]);

  // 切换标签页或页面内导航（modal 打开/关闭会改 URL）时重新判定
  useEffect(() => {
    const onActivated = () => { void refresh(); };
    // onUpdated 在一次导航里会触发好几次（loading、title、favicon、complete），
    // 而且别的标签页更新也会触发。不过滤的话打开一篇笔记就会跑起好几个
    // 判定周期，日志刷屏、注入也白做好几遍。
    const onUpdated = (
      _id: number,
      info: { url?: string; status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (!tab.active) return;
      // 只认真正改变了「在看哪一篇」的两种变化。
      if (info.url === undefined && info.status !== 'complete') return;
      void refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh]);

  async function pickRoot() {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      // 使用者在选择器里点了取消。这是正常操作，不是错误，也不该留下
      // 一条未捕获的 rejection——保持原状即可。
      return;
    }
    await saveRootHandle(handle);
    await attachRoot(handle);
  }

  /** 必须由点击调用：requestPermission 只在用户手势里才会弹框。 */
  async function restorePermission() {
    if (!root) return;
    let granted: boolean;
    try {
      granted = await ensurePermission(root);
    } catch (e) {
      // 目录已经不在了的时候 requestPermission 也可能直接抛 NotFoundError。
      // 那就不是授权问题，指望「再点一次恢复」永远好不了。
      if (!isMissingError(e)) throw e;
      setState({ kind: 'missing_root' });
      return;
    }
    if (!granted) {
      setMessage('授权未通过。也可以点顶栏的「仓库」重新选择目录。');
      return;
    }
    // 不在这里 refresh：attachRoot 里的 setStore 会重建 refresh，
    // 上面那个 effect 自然会跑一遍。手动调用只会用到闭包里的旧 store。
    await attachRoot(root);
  }

  async function saveCollector(id: string) {
    // 写入路径不再跟采集者挂钩，所以改 ID 不动路径。还没确认过路径就先别落盘——
    // 存下来会被当成「确认过」，把 need_path 那一步跳掉。
    await saveSettings(chromeLocalArea, {
      collector: id,
      datasetPath: pathConfirmed ? datasetPath : null,
      captureAuthor,
      captureShare,
    });
    setCollector(id);
    setEditingCollector(false);
  }

  async function savePath(value: string) {
    if (!collector) return;
    if (!isValidDatasetPath(value)) return;
    await saveSettings(chromeLocalArea, {
      collector, datasetPath: value, captureAuthor, captureShare,
    });
    setDatasetPath(value);
    setPathConfirmed(true);
    setEditingPath(false);
  }

  /** 开关一拨就落盘。这一页没有「保存」，见 CaptureSetup 的说明。 */
  async function saveCapture(next: { captureAuthor: boolean; captureShare: boolean }) {
    setCaptureAuthor(next.captureAuthor);
    setCaptureShare(next.captureShare);
    await saveSettings(chromeLocalArea, {
      collector,
      datasetPath: pathConfirmed ? datasetPath : null,
      ...next,
    });
  }

  async function doArchive(mode: ArchiveMode) {
    if (!store || !collector || !root) return;
    const plan = planOf(state);
    if (!plan) return;
    // 点按钮本身就是用户手势，所以这里能直接把权限要回来——权限刚被回收的
    // 常见情况下，使用者点一次「允许」就继续采，不必被打回授权页。
    // 必须赶在其他 await 之前，手势的有效期只有几秒。
    if (!(await ensurePermission(root))) {
      setMessage('目录授权已失效，采集没有开始。请重新授权后再试。');
      return;
    }
    // 权限有了不代表目录还在。不先探一遍就落盘，第一次写文件才会抛，
    // 那时进度条已经起来了，界面看上去像是采到一半崩掉。
    if (!(await rootExists(root))) {
      setMessage('数据仓库目录已不存在，采集没有开始。');
      setState({ kind: 'missing_root' });
      return;
    }
    if (!isValidDatasetPath(datasetPath)) {
      setMessage('写入路径不合法：每一段只能是小写字母、数字、连字符、下划线。');
      return;
    }

    // 两步页面交互，都在使用者眼皮底下发生，所以串行、各自兜住异常。
    // 任一步失败都不阻断归档——附属数据不该把主干拖下水。
    // 初值就是失败态：任何一条岔路（比如拿不到 tabId）都不该让后面的 archive
    // 拿到未赋值的变量，而那种情况是真失败，不是 skipped。
    let author: AuthorOutcome = { kind: 'fail', reason: 'inject_failed' };
    let share: ShareOutcome = { kind: 'fail', reason: 'inject_failed' };
    const noteToWrite = { ...plan.note };

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;

    // 作者卡片：约 1.5–3 秒，期间卡片会在页面上闪现后自动收起。
    // 关掉时整段跳过，连 pageStep 都不设——没发生的事不该在界面上出现。
    if (!captureAuthor) {
      author = { kind: 'skipped' };
    } else {
      setPageStep('author');
      try {
        if (tabId !== undefined) {
          const read = await readAuthorViaTab(tabId, plan.note.author.user_id);
          if (read.ok) {
            const card = extractAuthorCard(read.raw, nowBeijingIso());
            if (card) {
              noteToWrite.author = { ...plan.note.author, ...card };
              author = {
                kind: 'ok', fans: card.fans, interaction: card.interaction,
                approximate: card.approximate,
              };
            } else {
              // 卡片回来了但三个计数一个都没有，等同于没采到。
              author = { kind: 'fail', reason: 'timeout' };
            }
          } else {
            author = { kind: 'fail', reason: read.reason };
          }
        }
      } catch (e) {
        // 读作者是附属步骤，它自己出错绝不能把整篇采集带下水。
        author = { kind: 'fail', reason: 'page_error' };
      }
    }

    // 分享链接：让页面自己走完「分享 → 复制链接」。面板会弹出来一两秒，
    // 剪贴板被拦下不真写。解析与身份校验在 core，页面脚本只负责弄出原文。
    if (!captureShare) {
      share = { kind: 'skipped' };
    } else {
      setPageStep('share');
      try {
        if (tabId !== undefined) {
          const read = await readShareViaTab(tabId);
          if (read.ok) {
            const parsed = extractShareUrl(read.text, plan.note.noteId);
            if (parsed.ok) {
              noteToWrite.shareUrl = parsed.url;
              share = { kind: 'ok', url: parsed.url };
            } else {
              share = { kind: 'fail', reason: parsed.reason };
            }
          } else {
            share = { kind: 'fail', reason: read.reason };
          }
        }
      } catch (e) {
        share = { kind: 'fail', reason: 'page_error' };
      }
    }
    // 两条路都要清掉，否则关着开关采集时按钮会一直停在「采集中…」
    setPageStep(null);

    setMessage(null);
    setProgress({ done: 0, total: plan.note.images.length });
    let res;
    try {
      res = await archive({
        store,
        note: noteToWrite,
        comments: plan.comments,
        collector,
        datasetPath,
        mode,
        existing: plan.existing,
        supersede: plan.supersede,
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      setProgress(null);
      // 目录在落盘途中被删掉。没有指针写成功，仓库里不会留下半份数据
      // （见设计的「指针存在 ⟹ 数据完整」不变量），如实说清楚即可。
      if (isMissingError(e)) {
        setMessage('采集中断：数据仓库目录在写入过程中消失了。请重新选择目录后重试。');
        setState({ kind: 'missing_root' });
        return;
      }
      setMessage(`采集失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setProgress(null);
    // 路径由上面那个 effect 负责持久化，这里不再重复存一次。
    // 必须先 refresh 再记结果：refresh 会清空「本次」标记。
    await refresh();
    setJustArchived({
      mode,
      status: res.status,
      path: res.path,
      failures: res.failures,
      imageCount: plan.note.images.length,
      comments: plan.comments,
      commentImageFailures: res.commentImageFailures,
      author,
      share,
    });
  }

  async function openDelete() {
    if (!store) return;
    const noteId = planOf(state)?.note.noteId;
    if (!noteId) return;
    try {
      setDeletePlan(await planDelete(store, noteId));
    } catch (e) {
      setMessage(`读取索引失败，删除没有开始：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function confirmDelete() {
    if (!store || !root || !deletePlan) return;
    // 点确认本身就是用户手势，权限刚被回收时点一次「允许」就能继续。
    // 必须赶在其他 await 之前，手势的有效期只有几秒。
    if (!(await ensurePermission(root))) {
      setMessage('目录授权已失效，什么都没删。请重新授权后再试。');
      return;
    }
    const plan = deletePlan;
    let res: DeleteResult;
    try {
      res = await deleteNote(store, plan);
    } catch (e) {
      if (isMissingError(e)) {
        setMessage('数据仓库目录已不存在，删除没有完成。');
        setState({ kind: 'missing_root' });
        return;
      }
      // 顺序保证了残留只会是孤儿目录，所以这句话永远成立
      setMessage(`删除失败：${e instanceof Error ? e.message : String(e)}。索引指针可能已删除，数据目录可能有残留。`);
      return;
    }
    // 必须先 refresh 再记结果：refresh 会清空「本次」标记
    await refresh();
    setJustDeleted(res);
  }

  const configured =
    state.kind !== 'need_root' && state.kind !== 'need_permission' &&
    state.kind !== 'missing_root' &&
    state.kind !== 'need_collector' && state.kind !== 'need_path';

  return (
    <div className="panel">
      <header className="pt-top">
        {/* 这个容器即使没有 chip 也要渲染：撑开右侧图标靠的是它身上的
            margin-right:auto，跟着 configured 一起消失的话，首次配置阶段
            三个图标会整体塌到左边。 */}
        <div className="pt-chips">
          {configured && (
            <>
              <button className="chip" title="更换数据仓库目录" onClick={() => void pickRoot()}>
                <span className="k">仓库</span>
                <span className="v">{rootName}</span>
              </button>
              <button className="chip" title="更改采集者 ID" onClick={() => setEditingCollector(true)}>
                <span className="k">采集者</span>
                <span className="v">{collector}</span>
              </button>
            </>
          )}
        </div>
        {configured && (
          <button className="icon-btn" title="采集设置" onClick={() => setEditingCapture(true)}>
            <IconGear />
          </button>
        )}
        {configured && (
          <button className="icon-btn" title="浏览数据集" onClick={() => void openBrowser()}>
            <IconBrowse />
          </button>
        )}
        <button className="icon-btn" title="重新读取页面" onClick={() => void refresh()}>
          <IconRefresh />
        </button>
      </header>

      {editingCapture ? (
        <CaptureSetup
          captureAuthor={captureAuthor}
          captureShare={captureShare}
          onChange={(next) => void saveCapture(next)}
          onBack={() => setEditingCapture(false)}
        />
      ) : editingCollector ? (
        <CollectorSetup
          initial={collector}
          onSave={(id) => void saveCollector(id)}
          onCancel={() => setEditingCollector(false)}
        />
      ) : editingPath ? (
        <PathSetup
          initial={datasetPath}
          rootName={rootName}
          onSave={(value) => void savePath(value)}
          onCancel={() => setEditingPath(false)}
        />
      ) : state.kind === 'need_root' ? (
        <RootSetup onPick={() => void pickRoot()} />
      ) : state.kind === 'need_permission' ? (
        <PermissionSetup rootName={rootName} onRestore={() => void restorePermission()} />
      ) : state.kind === 'missing_root' ? (
        <MissingRootSetup
          rootName={rootName}
          onPick={() => void pickRoot()}
          onRecheck={() => void refresh()}
        />
      ) : state.kind === 'need_collector' ? (
        <CollectorSetup initial={null} onSave={(id) => void saveCollector(id)} />
      ) : state.kind === 'need_path' ? (
        <PathSetup
          initial={datasetPath}
          rootName={rootName}
          onSave={(value) => void savePath(value)}
        />
      ) : (
        <NoteView
          state={state}
          collector={collector ?? ''}
          datasetPath={datasetPath}
          onEditDatasetPath={() => setEditingPath(true)}
          onArchive={(m) => void doArchive(m)}
          progress={progress}
          message={message}
          justArchived={justArchived}
          pageStep={pageStep}
          deletePlan={deletePlan}
          onOpenDelete={() => void openDelete()}
          onCancelDelete={() => setDeletePlan(null)}
          onConfirmDelete={() => void confirmDelete()}
          justDeleted={justDeleted}
        />
      )}

      {message && !configured && <p className="hint" style={{ padding: '0 12px' }}>{message}</p>}

      <LogView log={log} onRefresh={() => void refresh()} />
    </div>
  );
}
