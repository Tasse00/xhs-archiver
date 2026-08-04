import { useState } from 'react';
import { isValidDatasetPath, isValidSegment, randomCollectorId } from '../../core/settings';
import { Empty } from './Empty';
import { IconFolder, IconId, IconPath } from './Icons';

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
  value, rootName, onChange, onConfirm,
}: {
  value: string;
  rootName: string | null;
  onChange(v: string): void;
  onConfirm(): void;
}) {
  const valid = isValidDatasetPath(value);
  return (
    <div className="pt-body">
      <div className="empty">
        <IconPath />
        <h2>确认存放位置</h2>
        <p>
          这次采集的笔记会写到 <b>{rootName ?? '数据仓库'}</b> 下面的这个路径里。
          按日期分是默认做法，也可以改成按主题分。
        </p>
        <label className="field">
          <span>写入路径</span>
          <input value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        </label>
        {valid ? (
          <div className="path-preview mono">{rootName ?? '<数据仓库>'}/{value}/{'{笔记ID}'}/</div>
        ) : (
          <div className="field-err">每一段只能用小写字母、数字、连字符、下划线，且不能以 _index 开头</div>
        )}
        <button className="btn btn-primary" disabled={!valid} onClick={onConfirm}>
          就用这个路径
        </button>
        <p className="hint">采集时在底部还能随时改，改完会记住。</p>
      </div>
    </div>
  );
}
