import type { ReactNode } from 'react';
import type { ExtractedComments, ExtractedNote, Pointer } from '../../types';
import type { AuthorReadFailure } from '../../page/read-author';
import type { ShareReadFailure } from '../../page/read-share';
import type { ShareUrlFailure } from '../../core/share';
import type { PanelState, UnreadableReason } from '../usePanelState';
import { Empty } from './Empty';
import { NoteCard } from './NoteCard';
import { Record } from './Record';
import { ArchiveActions, PathDisplay, type ArchiveMode } from './Actions';
import {
  IconCheck, IconCross, IconDoc, IconGlobe, IconLoading, IconPlug, IconVideo,
} from './Icons';

/**
 * 作者卡片这一步的结果。三态：采到、被使用者关掉、采失败。
 * 「关掉」不能塞进 AuthorReadFailure——那个枚举描述的是页面交互怎么失败的，
 * 而关掉根本没发生过交互，混进去会让文案表退化成什么都往里塞的字典。
 */
export type AuthorOutcome =
  | { kind: 'ok'; fans: number; interaction: number; approximate: boolean }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: AuthorReadFailure };

/**
 * 分享链接这一步的结果。失败原因跨两层：页面层没点开面板是一回事，
 * 解析层发现链接指向别的笔记是另一回事，两者的排查方向完全不同。
 */
export type ShareOutcome =
  | { kind: 'ok'; url: string }
  | { kind: 'skipped' }
  | { kind: 'fail'; reason: ShareReadFailure | ShareUrlFailure };

/** 本次会话刚完成的一次采集，仅在结果仍对应当前笔记时存在。 */
export interface ArchiveOutcome {
  mode: ArchiveMode;
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
  imageCount: number;
  comments: ExtractedComments;
  commentImageFailures: string[];
  author: AuthorOutcome;
  share: ShareOutcome;
}

const UNREADABLE: Record<UnreadableReason, { title: string; body: string }> = {
  inject_failed: {
    title: '注入页面脚本失败',
    body: '多半是扩展权限或页面还没就绪。在 chrome://extensions 里重新加载扩展后再试。',
  },
  page_error: {
    title: '脚本在页面里执行出错',
    body: '展开下方工作日志可以看到出错时的现场。',
  },
  panel_error: {
    title: '侧边栏自己出错了',
    body: '跟页面无关。展开下方工作日志可以看到出错时的现场。',
  },
  no_state: {
    title: '读不到页面数据',
    body: '页面上没有小红书的全局数据。请确认已经登录，然后刷新页面重试。',
  },
  no_note: {
    title: '找不到这篇笔记的数据',
    body: '重新打开这篇笔记试试。',
  },
  incomplete_data: {
    title: '这篇笔记还没加载完整',
    body: '稍等一下，或者刷新页面重试。',
  },
};

const AUTHOR_FAIL: Record<AuthorReadFailure, string> = {
  no_element: '页面上没找到作者元素',
  timeout: '等卡片超时',
  uid_mismatch: '卡片不属于这篇的作者',
  page_error: '页面脚本出错',
  inject_failed: '注入页面脚本失败',
};

const SHARE_FAIL: Record<ShareReadFailure | ShareUrlFailure, string> = {
  no_element: '页面上没找到分享按钮',
  no_panel: '分享面板没弹出来',
  no_item: '面板里没有「复制链接」',
  timeout: '等复制结果超时',
  no_url: '复制出来的文案里没有链接',
  id_mismatch: '链接指向别的笔记',
  page_error: '页面脚本出错',
  inject_failed: '注入页面脚本失败',
};

/** 只有这三种状态能采集，取出它们共有的部分。 */
function archivable(
  state: PanelState,
): { note: ExtractedNote; comments: ExtractedComments; existing: Pointer | null; extra: Pointer[] } | null {
  switch (state.kind) {
    case 'ready':
      return { note: state.note, comments: state.comments, existing: null, extra: [] };
    case 'mine':
      return { note: state.note, comments: state.comments, existing: state.pointer, extra: state.duplicates };
    case 'others':
      return {
        note: state.note,
        comments: state.comments,
        existing: state.pointers[0] ?? null,
        extra: state.pointers.slice(1),
      };
    default:
      return null;
  }
}

function Verdict({ state, sameDir }: { state: PanelState; sameDir: boolean }) {
  if (state.kind === 'ready') {
    return <div className="verdict is-ok"><b>可采集</b><span>还没有人采过这篇</span></div>;
  }
  if (state.kind === 'others') {
    return (
      <div className="verdict is-block">
        <b>{state.pointers[0]?.collector ?? '他人'} 采过这篇</b>
        <span>更新它等于接管</span>
      </div>
    );
  }
  if (state.kind === 'mine' && state.duplicates.length > 0) {
    return (
      <div className="verdict is-warn">
        <b>这篇存了 {state.duplicates.length + 1} 份</b>
        <span>建议迁移，合并成一份</span>
      </div>
    );
  }
  // 「我采过」是中性事实，不是警告，所以不上色
  return (
    <div className="verdict">
      <b>你采过这篇</b>
      <span>{sameDir ? '已在当前路径下' : '存放位置与当前路径不同'}</span>
    </div>
  );
}

export function Result({ outcome }: { outcome: ArchiveOutcome }) {
  const verb = outcome.mode === 'new' ? '采集' : outcome.mode === 'update' ? '更新' : '迁移';
  if (outcome.status === 'partial') {
    return (
      <div className="result bad">
        <div className="result-h"><IconCross />没{verb}完，索引没写</div>
        <dl>
          <dt>原因</dt><dd>{outcome.failures.join('；')}</dd>
          <dt>已写入</dt><dd className="mono">{outcome.path}/（标记为 partial）</dd>
        </dl>
        <div className="note">索引指针没有写入 —— 这篇仍然算「没采过」，可以直接重试。</div>
      </div>
    );
  }
  const c = outcome.comments;
  return (
    <div className="result ok">
      <div className="result-h"><IconCheck />{verb}完成</div>
      <dl>
        <dt>位置</dt><dd className="mono">{outcome.path}/</dd>
        <dt>配图</dt><dd>{outcome.imageCount} 张，全部写入</dd>
        <dt>评论</dt>
        <dd>
          {c.collectedCount} / {c.declaredTotal} 条{!c.complete && '（只采已加载的）'}
        </dd>
        <dt>作者</dt>
        <dd>
          {outcome.author.kind === 'ok' ? (
            <>
              {outcome.author.approximate && '约 '}
              {outcome.author.fans.toLocaleString('zh-CN')} 粉丝 ·{' '}
              {outcome.author.approximate && '约 '}
              {outcome.author.interaction.toLocaleString('zh-CN')} 获赞与收藏
            </>
          ) : outcome.author.kind === 'skipped' ? (
            <span className="hint">已在设置中关闭</span>
          ) : (
            <>作者信息未采到：{AUTHOR_FAIL[outcome.author.reason]}。重采这篇可以再试。</>
          )}
        </dd>
        <dt>分享链接</dt>
        <dd>
          {outcome.share.kind === 'ok' ? (
            '已记录'
          ) : outcome.share.kind === 'skipped' ? (
            <span className="hint">已在设置中关闭</span>
          ) : (
            <>分享链接未采到：{SHARE_FAIL[outcome.share.reason]}。重采这篇可以再试。</>
          )}
        </dd>
      </dl>
    </div>
  );
}

export function NoteView({
  state, collector, datasetPath, onEditDatasetPath, onArchive, progress, message, justArchived, pageStep,
}: {
  state: PanelState;
  collector: string;
  datasetPath: string;
  onEditDatasetPath(): void;
  onArchive(mode: ArchiveMode): void;
  progress: { done: number; total: number } | null;
  message: string | null;
  justArchived: ArchiveOutcome | null;
  /** 正在做哪一步页面交互。null 表示没在做。 */
  pageStep: 'author' | 'share' | null;
}) {
  /**
   * 没有笔记可采时的画面。路径输入框照样留在底部——它是「数据往哪写」的唯一
   * 出口，只在能按采集按钮时才出现的话，配置完却没打开笔记的人根本看不到它。
   */
  function idle(body: ReactNode) {
    return (
      <>
        {body}
        <div className="pt-act">
          <PathDisplay value={datasetPath} onEdit={onEditDatasetPath} disabled={progress !== null} />
        </div>
      </>
    );
  }

  if (state.kind === 'reading') {
    return idle(
      <div className="pt-body">
        <Empty icon={<IconLoading />} title="正在读取页面数据">
          小红书的笔记详情是异步加载的，通常一秒内就好。
        </Empty>
      </div>,
    );
  }

  if (state.kind === 'not_xhs') {
    return idle(
      <div className="pt-body">
        <Empty icon={<IconGlobe />} title="当前标签页不是小红书">
          打开 xiaohongshu.com 上的任意一篇图文笔记，这里就会显示它的信息。
        </Empty>
      </div>,
    );
  }

  if (state.kind === 'not_note') {
    return idle(
      <div className="pt-body">
        <Empty icon={<IconDoc />} title="还没打开笔记">
          点开一篇笔记 —— 独立页面或者首页上的弹窗都行。
        </Empty>
      </div>,
    );
  }

  if (state.kind === 'video_rejected') {
    return idle(
      <div className="pt-body">
        <Empty icon={<IconVideo />} title="视频笔记不采集">
          这个工具只归档图文笔记，视频明确不在范围内。换一篇图文笔记试试。
        </Empty>
      </div>,
    );
  }

  if (state.kind === 'unreadable') {
    const hint = UNREADABLE[state.reason];
    return idle(
      <div className="pt-body">
        <Empty
          icon={<IconPlug />}
          title={hint.title}
          code={state.reason}
          detail={state.detail}
          alert
        >
          {hint.body}
        </Empty>
      </div>,
    );
  }

  const a = archivable(state);
  if (!a) return idle(<div className="pt-body" />);

  // 刚点完按钮，最想知道的是成没成，所以结果卡排在笔记卡前面
  if (justArchived) {
    return idle(
      <div className="pt-body">
        <Result outcome={justArchived} />
        {justArchived.status === 'complete' && justArchived.commentImageFailures.length > 0 && (
          // 评论配图取不到不影响归档状态，但要说一声，别让人以为图都在
          <div className="verdict is-warn">
            <b>{justArchived.commentImageFailures.length} 张评论配图没取到</b>
            <span>笔记本身完整</span>
          </div>
        )}
        <p className="hint">切换到别的笔记后这条提示会消失。</p>
        <NoteCard note={a.note} comments={a.comments} />
      </div>,
    );
  }

  const sameDir = a.existing !== null
    && datasetPath.replace(/\/+$/, '') === a.existing.path.slice(0, a.existing.path.lastIndexOf('/'));

  return (
    <>
      <div className="pt-body">
        {/* 数据是从当前页面读的，中途切走就采不完。这句得摆在最显眼的位置。 */}
        {progress ? (
          <div className="verdict is-warn">
            <b>采集中，别关这篇笔记</b>
            <span>中途关掉或切走会让这次采集只写一半</span>
          </div>
        ) : (
          <Verdict state={state} sameDir={sameDir} />
        )}
        <NoteCard note={a.note} comments={a.comments} />

        {a.existing && (
          <div>
            <div className="sect-h">
              采集记录
              {a.extra.length > 0 && <><b>{a.extra.length + 1}</b> 处</>}
            </div>
            <Record pointer={a.existing} collector={collector} here={sameDir} />
            {a.extra.map((p) => <Record key={p.collector} pointer={p} collector={collector} />)}
          </div>
        )}

        {state.kind === 'others' && (
          <p className="hint">不会另存一份 —— 一篇笔记在仓库里始终只有一份，更新之后指针归你。</p>
        )}
      </div>

      <div className="pt-act">
        <PathDisplay value={datasetPath} onEdit={onEditDatasetPath} disabled={progress !== null} />
        {pageStep ? (
          <>
            <div className="sect-h">
              {pageStep === 'author' ? '正在读取作者信息…' : '正在读取分享链接…'}
            </div>
            <p className="hint">
              {pageStep === 'author'
                ? '页面上会闪一下作者卡片，随后自动收起。'
                : '页面上会弹一下分享面板，随后自动收起。剪贴板不会被改动。'}
            </p>
            <button className="btn" disabled>采集中…</button>
          </>
        ) : progress ? (
          <>
            <div className="sect-h">正在下载图片 <b>{progress.done} / {progress.total}</b></div>
            <div className="bar">
              <i style={{ width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%` }} />
            </div>
            <button className="btn" disabled>采集中…</button>
          </>
        ) : (
          <>
            <ArchiveActions
              existing={a.existing}
              datasetPath={datasetPath}
              collector={collector}
              busy={false}
              onArchive={onArchive}
            />
          </>
        )}
        {message && <div className="field-err">{message}</div>}
      </div>
    </>
  );
}
