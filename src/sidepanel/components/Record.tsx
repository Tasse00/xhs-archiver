import type { Pointer } from '../../types';

/** 指针的 path 是 `{写入路径}/{noteId}`，去掉末段就是当初的写入路径。 */
export function dirOf(p: Pointer): string {
  const i = p.path.lastIndexOf('/');
  return i < 0 ? p.path : p.path.slice(0, i);
}

/**
 * 一条既有的采集记录。自己采的和别人采的用同一个组件——对使用者来说要回答的
 * 问题是一样的：谁采的、什么时候、放在哪。
 */
export function Record({
  pointer, collector, here,
}: {
  pointer: Pointer;
  collector: string;
  /** 存放位置正好是当前写入路径。说明一句，否则「为什么没有迁移按钮」无从得知。 */
  here?: boolean;
}) {
  return (
    <div className={here ? 'rec is-here' : 'rec'}>
      <dl>
        <dt>采集者</dt>
        <dd>
          {pointer.collector}
          {pointer.collector === collector && <span className="me">（你）</span>}
        </dd>
        <dt>采集时间</dt>
        <dd>{pointer.last_archived_at.slice(0, 16).replace('T', ' ')}</dd>
        <dt>存放位置</dt>
        <dd className="mono">{pointer.path}/</dd>
      </dl>
      {here && <div className="rec-flag">就在当前写入路径下</div>}
    </div>
  );
}
