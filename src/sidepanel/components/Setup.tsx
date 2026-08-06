import { useState } from 'react';
import { isValidDatasetPath, isValidSegment, randomCollectorId } from '../../core/settings';
import { Empty } from './Empty';
import { IconFolder, IconGear, IconId, IconPath } from './Icons';

export function RootSetup({ onPick }: { onPick(): void }) {
  return (
    <div className="pt-body">
      <Empty
        icon={<IconFolder />}
        title="先选一个数据仓库目录"
        action={<button className="btn btn-auto btn-primary" onClick={onPick}>选择目录…</button>}
      >
        采集到的笔记会写进这个目录。它应该是一个独立的 Git 仓库，跟插件代码分开放。
      </Empty>
    </div>
  );
}

/**
 * 权限被回收后的恢复入口。这里刻意不是「重新选择目录」——目录句柄一直都在，
 * 让人再走一遍选择器等于把浏览器的限制转嫁给使用者。
 */
export function PermissionSetup({
  rootName, onRestore,
}: {
  rootName: string | null;
  onRestore(): void;
}) {
  return (
    <div className="pt-body">
      <Empty
        icon={<IconFolder />}
        title="需要重新授权数据仓库"
        action={<button className="btn btn-auto btn-primary" onClick={onRestore}>恢复授权</button>}
      >
        浏览器收回了对 <b>{rootName ?? '数据仓库'}</b> 的访问权限——关掉本扩展的其他标签页
        （比如浏览页）就会触发。目录还记着，点一下即可继续，不用重新选。
      </Empty>
    </div>
  );
}

/**
 * 目录从磁盘上消失后的出口。这里跟 PermissionSetup 刚好相反：句柄没坏、
 * 权限也在，坏的是目录本身，再点多少次「恢复授权」都没用，只能重新选。
 *
 * 先给「重新检查」是因为最常见的两种成因都是可逆的：目录被移走后又移回来、
 * 外置盘/网盘还没挂上。这时不该逼人再走一遍目录选择器。
 */
export function MissingRootSetup({
  rootName, onPick, onRecheck,
}: {
  rootName: string | null;
  onPick(): void;
  onRecheck(): void;
}) {
  return (
    <div className="pt-body">
      <Empty
        icon={<IconFolder />}
        title="找不到数据仓库目录"
        alert
        action={
          <>
            <button className="btn btn-auto btn-primary" onClick={onPick}>重新选择目录…</button>
            <button className="btn btn-auto btn-sm" onClick={onRecheck}>重新检查</button>
          </>
        }
      >
        <b>{rootName ?? '数据仓库'}</b> 已经不在原来的位置了——被删除、改名、移动，
        或者所在的磁盘没挂上，都会这样。若只是暂时读不到，放回原处后点「重新检查」；
        否则请重新选择目录。<b>在此之前无法采集</b>，以免数据写进一个不存在的地方。
      </Empty>
    </div>
  );
}

export function CollectorSetup({
  initial, onSave, onCancel,
}: {
  /** 改设置时带进来当前值；首次设置时为 null，给个随机的。 */
  initial: string | null;
  onSave(id: string): void;
  onCancel?(): void;
}) {
  const [value, setValue] = useState(initial ?? randomCollectorId());
  const valid = isValidSegment(value);
  return (
    <div className="pt-body">
      <div className="empty">
        <IconId />
        <h2>{initial ? '更改采集者 ID' : '取一个采集者 ID'}</h2>
        <p>它用来区分是谁采的，会写进索引。只能用小写字母、数字、连字符、下划线。</p>
        <label className="field">
          <span>采集者 ID</span>
          <input value={value} spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        </label>
        {!valid && <div className="field-err">只能包含 a-z、0-9、-、_，且不超过 32 字符</div>}
        <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(value)}>
          保存
        </button>
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

/**
 * 确认这一批笔记写到哪里。有默认值不等于使用者知道数据会落在哪——
 * 路径决定了仓库的组织方式，必须在采第一篇之前摆到眼前一次。
 */
export function PathSetup({
  initial, rootName, onSave, onCancel,
}: {
  initial: string;
  rootName: string | null;
  onSave(v: string): void;
  onCancel?(): void;
}) {
  const [value, setValue] = useState(initial);
  const valid = isValidDatasetPath(value);
  const editing = onCancel !== undefined;
  return (
    <div className="pt-body">
      <div className="empty">
        <IconPath />
        <h2>{editing ? '修改采集写入路径' : '设置采集写入路径'}</h2>
        <p>
          采集的笔记会写到 <b>{rootName ?? '数据仓库'}</b> 下面的这个路径里。
          默认统一存放在 <code>collected</code>。你也可以添加二级路径进行分类，
          例如按日期使用 <code>collected/2026-08-04</code>，或按主题使用
          {' '}<code>collected/outfit</code>。路径不会随日期自动变化，需要时请手动修改。
        </p>
        <label className="field">
          <span>写入路径</span>
          <input
            value={value}
            spellCheck={false}
            aria-invalid={!valid}
            aria-describedby={valid ? undefined : 'dataset-path-error'}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {valid ? (
          <div className="path-preview mono">{rootName ?? '<数据仓库>'}/{value}/{'{笔记ID}'}/</div>
        ) : (
          <div id="dataset-path-error" className="field-err" role="alert">
            每一段只能用小写字母、数字、连字符、下划线，且不能以 _index 开头
          </div>
        )}
        <button className="btn btn-primary" disabled={!valid} onClick={() => onSave(value)}>
          {editing ? '保存修改' : '使用这个路径'}
        </button>
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

/**
 * 采集开关。作者卡片与分享链接这两步都靠合成事件驱动页面自己走流程，
 * 对小红书的 DOM 结构有强依赖——平台改一次前端就可能让这两步各自空转到
 * 超时。这一页是那时候的逃生口，不必等插件发新版。
 *
 * 这里刻意没有「保存」按钮：同目录的 CollectorSetup / PathSetup 有输入校验、
 * 存在「填了一半不合法」的中间态，所以需要提交语义；布尔开关没有这回事，
 * 多一步保存只是让使用者多点一次。
 */
export function CaptureSetup({
  captureAuthor, captureShare, onChange, onBack,
}: {
  captureAuthor: boolean;
  captureShare: boolean;
  onChange(next: { captureAuthor: boolean; captureShare: boolean }): void;
  onBack(): void;
}) {
  return (
    <div className="pt-body">
      <div className="empty">
        <IconGear />
        <h2>采集设置</h2>
        <p>
          这两步都要驱动小红书页面自己走一遍流程。哪一步被平台改坏了，
          在这里关掉就能让采集立刻恢复顺畅，不用等插件更新。
        </p>

        <label className="switch">
          <input
            type="checkbox"
            checked={captureAuthor}
            onChange={(e) => onChange({ captureAuthor: e.target.checked, captureShare })}
          />
          <span className="switch-text">
            <b>采集作者信息</b>
            <i>简介、关注、粉丝、获赞与收藏。关掉后不再让作者卡片在页面上闪现。</i>
          </span>
        </label>

        <label className="switch">
          <input
            type="checkbox"
            checked={captureShare}
            onChange={(e) => onChange({ captureAuthor, captureShare: e.target.checked })}
          />
          <span className="switch-text">
            <b>采集分享链接</b>
            <i>能点开原帖的那个地址。关掉后不再弹分享面板，note.json 里不写 share_url。</i>
          </span>
        </label>

        <p className="hint">
          关掉只是跳过这一步，采集会更快，笔记正文、配图、评论照常。
          <b>已经采过的笔记不受影响</b>，仓库里的旧数据不会被改动。
          正常情况下两个都保持开启。
        </p>

        <button className="btn btn-sm" onClick={onBack}>返回</button>
      </div>
    </div>
  );
}
